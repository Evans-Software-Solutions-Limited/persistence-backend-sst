import { initSentry, wrapLambda } from "./shared/sentry";
import { AnalyticsEventRepository } from "./application/repositories/analyticsEventRepository";
import {
  forwardPendingToMeta,
  type MetaForwardSummary,
} from "./application/analytics/metaCapiForward";
import {
  isMetaCapiConfigured,
  sendConversionEvents,
} from "./application/analytics/metaCapiClient";

/**
 * Meta CAPI forward cron (spec-30 WS2, Option B) — scheduled via `sst.aws.Cron`
 * in infra/api.ts. Drains the `analytics_events` outbox (rows with
 * `meta_forwarded_at IS NULL`) to the Conversions API every few minutes.
 *
 * Thin impure edge: it wires the real repo + HTTP client into the deterministic
 * `forwardPendingToMeta`. No-ops immediately (one config check, no DB read) when
 * Meta is unconfigured — so an unset-secret stage costs effectively nothing.
 */
async function baseHandler(): Promise<MetaForwardSummary> {
  const repo = new AnalyticsEventRepository();
  const summary = await forwardPendingToMeta({
    markExpired: (cutoff) => repo.markExpiredForwarded(cutoff),
    listPending: (names, limit) => repo.listPendingMetaForward(names, limit),
    markForwarded: (ids) => repo.markMetaForwarded(ids),
    send: sendConversionEvents,
    configured: isMetaCapiConfigured,
    now: new Date(),
  });
  console.log(`[meta-capi-forward:summary] ${JSON.stringify(summary)}`);
  return summary;
}

// Initialise Sentry (no-op without SENTRY_DSN) and wrap so a Graph/DB failure is
// captured + flushed before the container freezes. A throw leaves the batch
// unforwarded (meta_forwarded_at stays null) → retried on the next drain.
initSentry();
export const handler = wrapLambda(baseHandler);
