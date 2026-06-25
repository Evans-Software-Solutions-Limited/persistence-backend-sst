import type Stripe from "stripe";
import { SubscriptionRepository } from "../../repositories/subscriptionRepository";
// `isUniqueViolation` extracted to a shared util (spec 17 / T-A.1.2) so the
// outbound new-sub insert path shares one implementation. Behaviour here is
// unchanged.
import { isUniqueViolation } from "../pgErrors";
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

  // Fallback to 'free' (was 'basic' pre-tier-simplification — basic no
  // longer exists). Defensive default; metadata is normally set by our
  // outbound subscription-create path.
  const tierName = subscription.metadata?.tier_name ?? "free";
  const billingCycle = subscription.metadata?.billing_cycle ?? "monthly";

  try {
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
  } catch (err) {
    if (isUniqueViolation(err)) {
      // The user already has an active/pending row in user_subscriptions
      // (partial-unique-index collision). This happens when a sub is
      // created out-of-band (Stripe dashboard) while a previous one is
      // still active, or when the outbound flow and the webhook race.
      //
      // Skipping is safe and necessary: the existing active row is the
      // authoritative state, and subsequent customer.subscription.{updated,
      // deleted} events on EITHER subscription will reconcile the local
      // state correctly. Rethrowing would return 500 → Stripe retries the
      // same event for ~3 days, hitting the same constraint each time,
      // until manual intervention.
      console.warn(
        `[stripe:subscription.created] external_subscription_id=${subscription.id} collides with the active-unique constraint for user=${userId} — skipping insert, existing row is canonical (Inspector Brad PR #69 high-severity find)`,
      );
      return;
    }
    throw err;
  }
}
