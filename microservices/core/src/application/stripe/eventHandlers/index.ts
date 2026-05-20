import type Stripe from "stripe";

/**
 * Per-event-type handler signature. Each handler is responsible for the
 * full side-effect chain for one Stripe event type. Returning normally
 * signals success; throwing signals failure — the caller releases the
 * idempotency claim and returns 500 so Stripe retries.
 *
 * Handlers MUST be idempotent: a duplicate delivery that races past the
 * `event_id` claim (rare but possible under parallel retries) should
 * leave the DB in the same state as a single delivery.
 */
export type StripeEventHandler = (event: Stripe.Event) => Promise<void>;

/**
 * Dispatch table mapping Stripe event types to handler functions.
 *
 * Phase 1 ships stub handlers that only log — they unblock the webhook
 * route end-to-end (signature verify + idempotency + dispatch routing)
 * and let the integration test suite run before the per-event business
 * logic lands. The real handlers are wired in the next commit and
 * write to `user_subscriptions` via `SubscriptionRepository`. The DB
 * trigger `update_subscription_limits_trigger` propagates derived state
 * to `profiles.subscription_id` / `profiles.role` / `subscription_limits`
 * automatically — handlers MUST NOT touch those columns.
 *
 * Event types covered (mirrors legacy stripe-webhook/index.ts switch):
 *   - customer.subscription.created
 *   - customer.subscription.updated   (heaviest — scheduled cancellation,
 *                                       upgrade rollback, etc.)
 *   - customer.subscription.deleted
 *   - invoice.payment_succeeded
 *   - invoice.payment_failed
 *   - customer.subscription.trial_will_end  (log-only in legacy)
 *
 * Events not in this table fall through to a log-and-200 path — Stripe
 * accepts new event types over time and we don't want to 500 on them.
 */
async function stubHandler(event: Stripe.Event): Promise<void> {
  console.log(
    `[stripe:webhook:stub] received ${event.type} (${event.id}) — handler stub, no side effects until next commit`,
  );
}

export const eventHandlers: Record<string, StripeEventHandler> = {
  "customer.subscription.created": stubHandler,
  "customer.subscription.updated": stubHandler,
  "customer.subscription.deleted": stubHandler,
  "invoice.payment_succeeded": stubHandler,
  "invoice.payment_failed": stubHandler,
  "customer.subscription.trial_will_end": stubHandler,
};

/**
 * Resolve the handler for an event type, or `null` when the event is
 * one we don't currently handle. Caller logs the unhandled type and
 * returns 200 — Stripe's webhook subscription is configured to fire a
 * superset of what we care about, so unhandled types are normal and
 * shouldn't trigger retries.
 */
export function resolveEventHandler(
  eventType: string,
): StripeEventHandler | null {
  return eventHandlers[eventType] ?? null;
}
