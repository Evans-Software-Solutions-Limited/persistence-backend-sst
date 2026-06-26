import { eq, sql } from "drizzle-orm";
import { revenuecatWebhookEvents } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Durable idempotency + lifecycle log for RevenueCat webhook events (M12 —
 * RevenueCat fronts both Apple IAP + Stripe). Direct analogue of
 * `StripeWebhookEventsRepository`; see that file for the full rationale.
 *
 * RevenueCat delivers at-least-once and WITHOUT ordering guarantees, and
 * retries (5/10/20/40/80 min) on any non-2xx. Each event row carries a
 * `status`:
 *   - `processing` — claimed, handler in flight.
 *   - `done`       — handled successfully. Future deliveries dedupe (skip).
 *   - `failed`     — handler threw. Re-claimable: RevenueCat's retry re-runs it.
 *
 * `claim()` is a single atomic upsert so dedupe + state transition can't race.
 */
export class RevenueCatWebhookEventsRepository {
  static readonly key = "RevenueCatWebhookEventsRepository";

  /**
   * How long a `processing` row may sit before it's considered abandoned
   * (worker crashed / Lambda timed out before mark-done/failed) and a new
   * delivery may re-claim it. Longer than the Lambda timeout, shorter than
   * RevenueCat's first retry interval (~5 min) — kept conservative at 15m to
   * match the Stripe repo and avoid double-processing a slow-but-alive worker.
   */
  static readonly STALE_PROCESSING_MINUTES = 15;

  /**
   * Atomically claim a RevenueCat event for processing. Returns `true` when the
   * caller owns the claim and should dispatch; `false` when the event is
   * already `done` (or a fresh concurrent `processing`) and dispatch should be
   * skipped.
   */
  async claim(
    eventId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const db = getDb();
    const staleCutoff = `${RevenueCatWebhookEventsRepository.STALE_PROCESSING_MINUTES} minutes`;
    const rows = await db
      .insert(revenuecatWebhookEvents)
      .values({
        eventId,
        type,
        payload,
        status: "processing",
        attempts: 1,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: revenuecatWebhookEvents.eventId,
        set: {
          status: "processing",
          attempts: sql`${revenuecatWebhookEvents.attempts} + 1`,
          updatedAt: new Date(),
        },
        // Only re-claim a non-`done` row that is either failed or a stale
        // (abandoned) processing row. A `done` row or a fresh `processing`
        // row fails this predicate → no update → empty RETURNING → skip.
        setWhere: sql`${revenuecatWebhookEvents.status} = 'failed' OR (${revenuecatWebhookEvents.status} = 'processing' AND ${revenuecatWebhookEvents.updatedAt} < now() - ${staleCutoff}::interval)`,
      })
      .returning({ id: revenuecatWebhookEvents.eventId });

    return rows.length > 0;
  }

  /** Mark an event handled. Future deliveries of the same id dedupe (skip). */
  async markDone(eventId: string): Promise<void> {
    const db = getDb();
    await db
      .update(revenuecatWebhookEvents)
      .set({ status: "done", updatedAt: new Date() })
      .where(eq(revenuecatWebhookEvents.eventId, eventId));
  }

  /**
   * Mark an event's handler as failed (queryable, re-claimable). The row stays
   * so a stranded event is never silently lost and shows up in a
   * `WHERE status <> 'done'` reconciliation sweep.
   */
  async markFailed(eventId: string, error: string): Promise<void> {
    const db = getDb();
    await db
      .update(revenuecatWebhookEvents)
      .set({
        status: "failed",
        lastError: error.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(revenuecatWebhookEvents.eventId, eventId));
  }
}
