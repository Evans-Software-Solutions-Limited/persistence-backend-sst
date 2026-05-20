import type Stripe from "stripe";
import { SubscriptionRepository } from "../../repositories/subscriptionRepository";
import { getStripe } from "../stripeClient";
import {
  readCurrentPeriodEnd,
  readInvoiceSubscriptionId,
  unixSecondsToDate,
} from "./_helpers";

/**
 * Handler for `invoice.payment_succeeded` — Stripe fires this on every
 * successful recurring charge (and the initial charge on a new
 * subscription).
 *
 * Effect on our DB: refresh the subscription's `payment_status`,
 * `next_billing_date`, `expires_at`, and `trial_ends_at` from Stripe
 * truth. This is the heartbeat that keeps the local row aligned with
 * Stripe's view of "when is the user paid through?".
 *
 * Notable difference from the legacy: legacy also wrote
 * `profiles.subscription_status` + `profiles.subscription_expires_at`
 * directly (lines 638-645). The V2 `profiles` schema doesn't have those
 * columns — derived state lives only in `profiles.subscription_id`
 * (a pointer the trigger maintains) + `subscription_limits` (also
 * trigger-managed). So we write to `user_subscriptions` and stop.
 */
export async function handleInvoicePaymentSucceeded(
  event: Stripe.Event,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  const subscriptionId = readInvoiceSubscriptionId(invoice);
  if (subscriptionId === null) {
    console.log(
      `[stripe:invoice.payment_succeeded] invoice ${invoice.id} has no subscription — skipping (one-off invoice)`,
    );
    return;
  }

  // Same SDK-Response cast as subscriptionUpdated — Stripe SDK v22 wraps
  // retrieves in Response<T> without exposing T's fields index-accessibly
  // in TS, but the wrapper IS a Subscription at runtime.
  const subscription = (await getStripe().subscriptions.retrieve(
    subscriptionId,
  )) as Stripe.Subscription;
  const userId = subscription.metadata?.supabase_user_id;
  if (typeof userId !== "string" || userId.length === 0) {
    console.warn(
      `[stripe:invoice.payment_succeeded] subscription ${subscriptionId} missing supabase_user_id — skipping`,
    );
    return;
  }

  const repo = new SubscriptionRepository();
  const userSubscription = await repo.findByExternalId(subscriptionId);
  if (userSubscription === null) {
    console.warn(
      `[stripe:invoice.payment_succeeded] no local row for external_subscription_id=${subscriptionId} — skipping`,
    );
    return;
  }

  const nextBillingDate = unixSecondsToDate(readCurrentPeriodEnd(subscription));
  // Default `payment_status` to "active" rather than "pending" — the
  // invoice succeeded, so even if subscription.status comes back stale
  // from Stripe, the user is definitively paid through the next cycle.
  // Matches legacy line 612.
  const paymentStatus =
    subscription.status === "trialing"
      ? "trialing"
      : subscription.status === "past_due"
        ? "past_due"
        : "active";

  await repo.updateById(userSubscription.id, {
    paymentStatus,
    nextBillingDate,
    expiresAt: nextBillingDate,
    trialEndsAt: unixSecondsToDate(subscription.trial_end),
  });
}
