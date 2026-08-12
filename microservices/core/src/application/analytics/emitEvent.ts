import { AnalyticsEventRepository } from "../repositories/analyticsEventRepository";
import type { AnalyticsEventInput } from "./events";

/**
 * Best-effort first-party event emit (spec-30 R1.2 / HC-2).
 *
 * Writes one `analytics_events` row. That table is also the Meta CAPI outbox
 * (Option B) — a separate cron forwards rows — so emitting is a single local
 * insert with no outbound HTTP on the request path. This keeps every call-site
 * (the RevenueCat webhook, `/leads/*`, the session write) fast and fully
 * isolated: a DB failure here is logged and swallowed, NEVER rethrown, so
 * instrumentation can never fail a user-facing write or the webhook.
 *
 * The input is the canonical contract a future client emitter (build-2) will
 * POST to `/analytics/events`; this server helper is just the direct path.
 */
export async function emitEvent(event: AnalyticsEventInput): Promise<void> {
  try {
    await new AnalyticsEventRepository().insert(event);
  } catch (err) {
    console.error(
      `[analytics:emit] failed for ${event.name}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
