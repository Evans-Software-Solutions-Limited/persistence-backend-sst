import type Stripe from "stripe";
import { SubscriptionRepository } from "../../repositories/subscriptionRepository";
import {
  mapStripeStatusToPaymentStatus,
  readCurrentPeriodEnd,
  readUserIdFromMetadata,
  unixSecondsToDate,
} from "./_helpers";

/**
 * Handler for `customer.subscription.created`.
 *
 * Idempotent: if a `user_subscriptions` row already exists for this
 * Stripe subscription id (because the outbound `POST /subscriptions`
 * endpoint already inserted it), we skip. The webhook is then doing
 * nothing useful for this event — that's fine; in practice the outbound
 * endpoint and the webhook BOTH write, and whoever lands first wins.
 *
 * When no row exists yet (subscription created out-of-band, e.g. from
 * the Stripe dashboard or a migration), we insert a fresh row sourced
 * entirely from the Stripe event. The DB trigger
 * `update_subscription_limits_trigger` propagates `subscription_id`,
 * `role`, and `subscription_limits.*` automatically after our insert
 * commits.
 *
 * Mirrors legacy stripe-webhook lines 106-174.
 */
export async function handleSubscriptionCreated(
  event: Stripe.Event,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const userId = readUserIdFromMetadata(subscription);
  if (userId === null) {
    console.warn(
      `[stripe:subscription.created] ${subscription.id} missing supabase_user_id — skipping`,
    );
    return;
  }

  const repo = new SubscriptionRepository();
  const existing = await repo.findByExternalId(subscription.id);
  if (existing !== null) {
    // Already inserted by the outbound endpoint or a prior delivery of
    // this event. Idempotent skip.
    console.log(
      `[stripe:subscription.created] external_subscription_id=${subscription.id} already present — idempotent skip`,
    );
    return;
  }

  const tierName = subscription.metadata?.tier_name ?? "basic";
  const billingCycle = subscription.metadata?.billing_cycle ?? "monthly";

  await repo.insert({
    userId,
    tierName,
    billingCycle,
    paymentStatus: mapStripeStatusToPaymentStatus(subscription.status),
    startsAt: unixSecondsToDate(subscription.created) ?? new Date(),
    expiresAt: unixSecondsToDate(readCurrentPeriodEnd(subscription)),
    trialEndsAt: unixSecondsToDate(subscription.trial_end),
    nextBillingDate: unixSecondsToDate(readCurrentPeriodEnd(subscription)),
    externalSubscriptionId: subscription.id,
    metadata: {
      stripe_customer_id:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      stripe_subscription_id: subscription.id,
    },
  });
}
