import type { PendingMetaEvent } from "../repositories/analyticsEventRepository";
import type { MetaServerEvent } from "./metaCapiClient";
import {
  META_FORWARDED_EVENT_NAMES,
  mapPendingToMetaEvents,
} from "./metaEventMap";

/**
 * Meta CAPI outbox drainer (spec-30 WS2, Option B). Pure logic + injected deps
 * so it is deterministic under test; the clock/DB/HTTP live at the impure edge
 * in `metaCapiForwardCron.ts`.
 *
 * `analytics_events` IS the outbox: rows with `meta_forwarded_at IS NULL` are
 * pending. Each drain first retires rows past Meta's acceptance window (they can
 * never forward), then pulls a bounded batch of the fresh remainder, maps them
 * to Meta events, POSTs once, and stamps the batch forwarded. `send` throws on a
 * Graph failure → the fresh batch is not marked and retries next drain
 * (at-least-once; Meta dedups on `event_id`). No-ops entirely when unconfigured
 * (HC-3), so a stage without Meta secrets is a clean, cheap no-op.
 */

/**
 * Meta's Conversions API rejects events whose `event_time` is more than ~7 days
 * in the past. Rows older than this can NEVER forward, so the drainer marks them
 * done without sending — otherwise a rollout that enables Meta secrets weeks
 * after deploy (rows already aged out), or a persistently-bad token, would
 * re-pull the same unsendable oldest batch every drain forever and grow the
 * table unbounded (the head-of-line-blocking / unbounded-growth failure mode).
 */
export const META_EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface MetaForwardDeps {
  /** Bulk-mark pending rows older than `cutoff` forwarded (no send). Returns count. */
  markExpired: (cutoff: Date) => Promise<number>;
  listPending: (names: string[], limit: number) => Promise<PendingMetaEvent[]>;
  markForwarded: (ids: string[]) => Promise<void>;
  send: (events: MetaServerEvent[]) => Promise<boolean>;
  configured: () => boolean;
  /** Max outbox rows per drain (default 200). */
  batchLimit?: number;
  /** Injected clock (defaults to now); the age cutoff = now − 7 days. */
  now?: Date;
}

export interface MetaForwardSummary {
  configured: boolean;
  /** Fresh rows pulled this drain (within Meta's window). */
  pending: number;
  /** Fresh rows stamped forwarded after a successful send. */
  forwarded: number;
  /** Rows dropped for being past Meta's acceptance window (no send). */
  skipped: number;
  /** Meta events actually sent (a row can produce 0–2). */
  metaEvents: number;
}

export async function forwardPendingToMeta(
  deps: MetaForwardDeps,
): Promise<MetaForwardSummary> {
  if (!deps.configured()) {
    return {
      configured: false,
      pending: 0,
      forwarded: 0,
      skipped: 0,
      metaEvents: 0,
    };
  }

  // 1. Retire rows past Meta's window in ONE statement (unbatched) so a backlog
  //    can't stall fresh events behind it. Committed before the send below, so
  //    even if the send throws, the unsendable rows still leave the pending set.
  const cutoff = new Date(
    (deps.now ?? new Date()).getTime() - META_EVENT_MAX_AGE_MS,
  );
  const skipped = await deps.markExpired(cutoff);

  // 2. Forward the fresh remainder (markExpired already excluded the aged rows).
  const limit = deps.batchLimit ?? 200;
  const pending = await deps.listPending(
    [...META_FORWARDED_EVENT_NAMES],
    limit,
  );
  if (pending.length === 0) {
    return {
      configured: true,
      pending: 0,
      forwarded: 0,
      skipped,
      metaEvents: 0,
    };
  }

  const events = pending.flatMap(mapPendingToMetaEvents);
  if (events.length > 0) {
    // Throws on a Graph non-2xx → fresh rows not marked below, retried next
    // drain (still within their window); the expired rows above stay retired.
    await deps.send(events);
  }
  // Stamp every pulled row (including any that mapped to 0 events — they matched
  // the filter, so they must not re-scan forever).
  await deps.markForwarded(pending.map((p) => p.id));

  return {
    configured: true,
    pending: pending.length,
    forwarded: pending.length,
    skipped,
    metaEvents: events.length,
  };
}
