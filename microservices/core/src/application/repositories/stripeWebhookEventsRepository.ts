import { eq } from "drizzle-orm";
import { stripeWebhookEvents } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Idempotency log for Stripe webhook events. Inserted by `event_id` BEFORE
 * the per-event handler runs side effects; ON CONFLICT DO NOTHING gives
 * O(1) dedup against Stripe's at-least-once delivery semantics.
 *
 * Race scenario this guards against: Stripe retries an event we already
 * processed → we ON-CONFLICT-skip the insert → return 200 silently → no
 * duplicate side effects. The legacy Supabase Edge Function had no
 * dedup; this closes that gap.
 *
 * Failure-mode handling: if the side-effect dispatch throws AFTER we've
 * claimed the event_id, the caller MUST delete the row so Stripe's
 * subsequent retry can re-run the handler. `release()` exists for that
 * rollback path.
 */
export class StripeWebhookEventsRepository {
  static readonly key = "StripeWebhookEventsRepository";

  /**
   * Atomically claim a Stripe event for processing.
   *
   * Returns `true` when this caller successfully inserted the row (new
   * event — caller proceeds to dispatch). Returns `false` when the
   * row already existed (duplicate — caller short-circuits with 200).
   *
   * `event` is the full Stripe event JSON, persisted in the `payload`
   * column for forensic replay. We persist before any side-effect
   * code touches the event so a handler bug can be replayed offline
   * against the exact bytes Stripe sent.
   */
  async claim(
    eventId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const db = getDb();
    const inserted = await db
      .insert(stripeWebhookEvents)
      .values({
        eventId,
        type,
        payload,
      })
      .onConflictDoNothing({ target: stripeWebhookEvents.eventId })
      .returning({ id: stripeWebhookEvents.eventId });

    return inserted.length > 0;
  }

  /**
   * Release the claim on an event_id. Called from the webhook handler's
   * error path when the side-effect dispatch throws — without this,
   * the next Stripe retry would see the event_id row and skip dispatch
   * entirely, leaving the original failure permanent.
   *
   * Best-effort: a failure here is swallowed by the caller. The worst
   * case is a stranded event_id row that prevents one retry — usually
   * Stripe sends several retries so a subsequent delivery still
   * arrives, and (more importantly) the upstream error is already
   * being logged + returned 500.
   */
  async release(eventId: string): Promise<void> {
    const db = getDb();
    await db
      .delete(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.eventId, eventId));
  }
}
