import type Stripe from "stripe";
import { handleInvoicePaymentFailed } from "./invoicePaymentFailed";
import { handleInvoicePaymentSucceeded } from "./invoicePaymentSucceeded";
import { handleSubscriptionCreated } from "./subscriptionCreated";
import { handleSubscriptionDeleted } from "./subscriptionDeleted";
import { handleSubscriptionUpdated } from "./subscriptionUpdated";
import { handleTrialWillEnd } from "./trialWillEnd";

/**
 * Per-event-type handler signature. Each handler is responsible for the
 * full side-effect chain for one Stripe event type. Returning normally
 * signals success; throwing signals failure — the caller releases the
 * idempotency claim and returns 500 so Stripe retries.
 *
 * Handlers MUST be idempotent: a duplicate delivery that races past the
 * `event_id` claim (rare but possible under parallel retries) should
 * leave the DB in the same state as a single delivery. The DB-trigger
 * `update_subscription_limits_trigger` is also idempotent — it
 * recomputes derived state from scratch on each user_subscriptions
 * write, so repeated writes don't drift.
 */
export type StripeEventHandler = (event: Stripe.Event) => Promise<void>;

/**
 * Dispatch table mapping Stripe event types to handler functions.
 * Mirrors the 6 cases of the legacy stripe-webhook switch statement.
 *
 * Events not in this table fall through to a log-and-200 path — Stripe
 * accepts new event types over time and we don't want to 500 on them.
 */
export const eventHandlers: Record<string, StripeEventHandler> = {
  "customer.subscription.created": handleSubscriptionCreated,
  "customer.subscription.updated": handleSubscriptionUpdated,
  "customer.subscription.deleted": handleSubscriptionDeleted,
  "invoice.payment_succeeded": handleInvoicePaymentSucceeded,
  "invoice.payment_failed": handleInvoicePaymentFailed,
  "customer.subscription.trial_will_end": handleTrialWillEnd,
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
