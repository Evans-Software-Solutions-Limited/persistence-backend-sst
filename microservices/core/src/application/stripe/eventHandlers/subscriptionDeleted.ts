import type Stripe from "stripe";
import { SubscriptionRepository } from "../../repositories/subscriptionRepository";
import {
  readCurrentPeriodEnd,
  readUserIdFromMetadata,
  unixSecondsToDate,
} from "./_helpers";

/**
 * Handler for `customer.subscription.deleted` — Stripe fires this when
 * a subscription's billing period has fully elapsed after cancellation
 * (or on an immediate cancellation).
 *
 * What we write to `user_subscriptions`:
 *   - payment_status = "cancelled"
 *   - cancelled_at  = subscription.canceled_at, falling back to now()
 *                     (Stripe sometimes omits canceled_at on programmatic
 *                     cancel — the legacy did the same fallback).
 *   - expires_at    = subscription.current_period_end (NOT cancelled_at —
 *                     cancelled_at is when the request was made; expires_at
 *                     is when access actually ends, which is the period
 *                     boundary).
 *
 * What we do NOT write: profiles.subscription_id, profiles.role,
 * subscription_limits — the `update_subscription_limits_trigger` Postgres
 * trigger maintains those derived columns automatically AFTER our update.
 *
 * Mirrors legacy stripe-webhook lines 545-585.
 */
export async function handleSubscriptionDeleted(
  event: Stripe.Event,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const userId = readUserIdFromMetadata(subscription);
  if (userId === null) {
    console.warn(
      `[stripe:subscription.deleted] ${subscription.id} missing supabase_user_id — skipping`,
    );
    return;
  }

  const repo = new SubscriptionRepository();
  const userSubscription = await repo.findByExternalId(subscription.id);
  if (userSubscription === null) {
    console.warn(
      `[stripe:subscription.deleted] no local row for external_subscription_id=${subscription.id} — out-of-band sub, skipping`,
    );
    return;
  }

  const cancelledAt = unixSecondsToDate(subscription.canceled_at) ?? new Date();
  // expires_at: prefer current_period_end (when access actually ends).
  // Falls back to cancelled_at when Stripe didn't return a period end
  // (rare; happens for immediate-cancel of a never-billed sub).
  const expiresAt =
    unixSecondsToDate(readCurrentPeriodEnd(subscription)) ?? cancelledAt;

  await repo.updateById(userSubscription.id, {
    paymentStatus: "cancelled",
    cancelledAt,
    expiresAt,
  });
}
