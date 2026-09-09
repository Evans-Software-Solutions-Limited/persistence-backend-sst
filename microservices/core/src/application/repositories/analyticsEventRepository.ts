import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { analyticsEvents, profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { AnalyticsEventInput } from "../analytics/events";

/**
 * Data access for `analytics_events` (spec-30 growth instrumentation).
 *
 * Two jobs:
 *  1. `insert` — the append-only write behind `emitEvent` (best-effort; the
 *     emitter, not this class, owns the try/catch).
 *  2. the Meta CAPI outbox reads — `listPendingMetaForward` / `markMetaForwarded`
 *     drive the `meta-capi-forward` cron (Option B, spec-30 design).
 *
 * The table is the outbox: a row with `meta_forwarded_at IS NULL` has not been
 * sent to Meta yet. Email is NEVER stored here (HC-4) — the pending read joins
 * `profiles` so the drainer can hash it in-flight; it is dropped after send.
 */

/** One pending outbox row plus the (transient) email needed for CAPI user_data. */
export interface PendingMetaEvent {
  id: string;
  userId: string | null;
  /** From `profiles.email` at read time — hashed in-flight, never persisted. */
  email: string | null;
  /**
   * From `profiles.marketing_consent` at read time (spec-30 R2.7). Gates whether
   * a USER-ATTRIBUTED row may forward; anonymous rows (leads, store clicks) carry
   * their consent in `properties.marketing_consent` instead. NULL = never asked.
   */
  marketingConsent: boolean | null;
  eventName: string;
  occurredAt: Date;
  properties: Record<string, unknown>;
  source: string;
  eventId: string | null;
}

export class AnalyticsEventRepository {
  static readonly key = "AnalyticsEventRepository";

  /**
   * Append one event row. Throws on a DB error — callers (`emitEvent`, the
   * webhook/leads/session emit wrappers) wrap this so a failure is logged and
   * never propagates to the user-facing path (spec-30 HC-2).
   */
  async insert(event: AnalyticsEventInput): Promise<void> {
    const db = getDb();
    await db
      .insert(analyticsEvents)
      .values({
        userId: event.userId ?? null,
        eventName: event.name,
        ...(event.occurredAt !== undefined
          ? { occurredAt: event.occurredAt }
          : {}),
        properties: event.properties ?? {},
        source: event.source ?? "server",
        eventId: event.eventId ?? null,
      })
      // Idempotency: an at-least-once path (the RC webhook emits before
      // mark-done, so a crash-then-retry re-emits the same event.id) must not
      // double-count the funnel. The partial unique index on
      // (event_name, event_id) makes that second insert a no-op; NULL event_ids
      // are exempt and still insert.
      //
      // ⚠ Scoped BY NAME for a reason. When that index was unique on `event_id`
      // alone, this clause silently discarded the founding webhook's `purchase`
      // row, because `checkout_started` had already claimed the buyer's shared
      // id — one checkout deliberately reuses ONE id across both events, since
      // Meta dedups per (event_name, event_id). Never widen it back.
      .onConflictDoNothing();
  }

  /**
   * Oldest-first batch of not-yet-forwarded events whose name is in
   * `eventNames` (the Meta-mapped set). Left-joins `profiles` for the email so
   * the drainer can build `user_data` without a second query. `ORDER BY
   * occurred_at` is served by the partial `analytics_events_meta_pending_idx`.
   */
  async listPendingMetaForward(
    eventNames: string[],
    limit: number,
  ): Promise<PendingMetaEvent[]> {
    if (eventNames.length === 0) return [];
    const db = getDb();
    const rows = await db
      .select({
        id: analyticsEvents.id,
        userId: analyticsEvents.userId,
        email: profiles.email,
        marketingConsent: profiles.marketingConsent,
        eventName: analyticsEvents.eventName,
        occurredAt: analyticsEvents.occurredAt,
        properties: analyticsEvents.properties,
        source: analyticsEvents.source,
        eventId: analyticsEvents.eventId,
      })
      .from(analyticsEvents)
      .leftJoin(profiles, eq(analyticsEvents.userId, profiles.id))
      .where(
        and(
          isNull(analyticsEvents.metaForwardedAt),
          inArray(analyticsEvents.eventName, eventNames),
        ),
      )
      .orderBy(analyticsEvents.occurredAt)
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      email: r.email ?? null,
      marketingConsent: r.marketingConsent ?? null,
      eventName: r.eventName,
      occurredAt: r.occurredAt,
      properties: (r.properties ?? {}) as Record<string, unknown>,
      source: r.source,
      eventId: r.eventId,
    }));
  }

  /**
   * Mark every pending row older than `cutoff` as forwarded WITHOUT sending —
   * they are past Meta's ~7-day `event_time` acceptance window and would be
   * rejected. One bulk UPDATE (not batch-limited) so a rollout backlog can't
   * stall fresh events behind it, and so the pending set always drains rather
   * than growing unbounded when Meta is misconfigured. Returns the count skipped.
   */
  async markExpiredForwarded(cutoff: Date): Promise<number> {
    const db = getDb();
    const rows = await db
      .update(analyticsEvents)
      .set({ metaForwardedAt: new Date() })
      .where(
        and(
          isNull(analyticsEvents.metaForwardedAt),
          lt(analyticsEvents.occurredAt, cutoff),
        ),
      )
      .returning({ id: analyticsEvents.id });
    return rows.length;
  }

  /** Stamp a batch of rows as forwarded so the next drain skips them. */
  async markMetaForwarded(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = getDb();
    await db
      .update(analyticsEvents)
      .set({ metaForwardedAt: new Date() })
      .where(inArray(analyticsEvents.id, ids));
  }
}
