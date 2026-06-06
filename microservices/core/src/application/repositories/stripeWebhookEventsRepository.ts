import { eq, sql } from "drizzle-orm";
import { stripeWebhookEvents } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Durable idempotency + lifecycle log for Stripe webhook events (spec 17 /
 * Phase B, closes audit MED-2).
 *
 * Each event row carries a `status`:
 *   - `processing` — claimed, handler in flight.
 *   - `done`       — handled successfully. Future deliveries dedupe (skip).
 *   - `failed`     — handler threw. Queryable + re-claimable: Stripe's retry
 *                    re-runs it.
 *
 * The row is NEVER deleted (the old `release()`-by-DELETE model could strand
 * an event forever if BOTH the handler and the delete failed). Instead a
 * failed handler marks the row `failed`; the next delivery re-claims it.
 *
 * `claim()` is a single atomic upsert so the dedupe + state transition can't
 * race:
 *   - new event id            → INSERT (processing)        → claimed
 *   - existing `done`          → conflict, no update        → NOT claimed (skip)
 *   - existing `failed`        → conflict, re-claim         → claimed (retry)
 *   - existing `processing`,
 *       fresh (< STALE)        → conflict, no update        → NOT claimed
 *       (a concurrent duplicate delivery — let the in-flight worker finish)
 *   - existing `processing`,
 *       stale (>= STALE)       → conflict, re-claim         → claimed
 *       (the prior worker crashed mid-flight; recover the stranded event)
 */
export class StripeWebhookEventsRepository {
  static readonly key = "StripeWebhookEventsRepository";

  /**
   * How long a `processing` row may sit before it's considered abandoned
   * (worker crashed / Lambda timed out before mark-done/failed) and a new
   * delivery is allowed to re-claim it. Comfortably longer than the Lambda
   * timeout, shorter than Stripe's first retry interval (~1h).
   */
  static readonly STALE_PROCESSING_MINUTES = 15;

  /**
   * Atomically claim a Stripe event for processing. Returns `true` when the
   * caller owns the claim and should dispatch; `false` when the event is
   * already `done` (or a fresh concurrent `processing`) and dispatch should
   * be skipped.
   */
  async claim(
    eventId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const db = getDb();
    const staleCutoff = `${StripeWebhookEventsRepository.STALE_PROCESSING_MINUTES} minutes`;
    const rows = await db
      .insert(stripeWebhookEvents)
      .values({
        eventId,
        type,
        payload,
        status: "processing",
        attempts: 1,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: stripeWebhookEvents.eventId,
        set: {
          status: "processing",
          attempts: sql`${stripeWebhookEvents.attempts} + 1`,
          updatedAt: new Date(),
        },
        // Only re-claim a non-`done` row that is either failed or a stale
        // (abandoned) processing row. A `done` row or a fresh `processing`
        // row fails this predicate → no update → empty RETURNING → skip.
        setWhere: sql`${stripeWebhookEvents.status} = 'failed' OR (${stripeWebhookEvents.status} = 'processing' AND ${stripeWebhookEvents.updatedAt} < now() - ${staleCutoff}::interval)`,
      })
      .returning({ id: stripeWebhookEvents.eventId });

    return rows.length > 0;
  }

  /** Mark an event handled. Future deliveries of the same id dedupe (skip). */
  async markDone(eventId: string): Promise<void> {
    const db = getDb();
    await db
      .update(stripeWebhookEvents)
      .set({ status: "done", updatedAt: new Date() })
      .where(eq(stripeWebhookEvents.eventId, eventId));
  }

  /**
   * Mark an event's handler as failed (queryable, re-claimable). Replaces the
   * old delete-based `release()` — the row stays so a stranded event is never
   * silently lost and shows up in the `WHERE status <> 'done'` reconciliation
   * sweep.
   */
  async markFailed(eventId: string, error: string): Promise<void> {
    const db = getDb();
    await db
      .update(stripeWebhookEvents)
      .set({
        status: "failed",
        lastError: error.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(stripeWebhookEvents.eventId, eventId));
  }
}
