import type Stripe from "stripe";
import { SubscriptionRepository } from "../../repositories/subscriptionRepository";
import { getStripe } from "../stripeClient";
import {
  readCurrentPeriodEnd,
  readInvoiceSubscriptionId,
  unixSecondsToDate,
} from "./_helpers";

/**
 * Derive the `payment_status` to write when `invoice.payment_succeeded`
 * arrives, based on the retrieved Stripe subscription's status.
 *
 * Returns `null` when the subscription is NOT actively billing — caller
 * skips the local update entirely, preserving whatever state
 * `subscriptionDeleted` (or any other webhook) has already written.
 *
 * Why this is necessary: Stripe fires `invoice.payment_succeeded` for the
 * final prorated invoice when an outbound flow calls
 * `subscriptions.cancel(id, { invoice_now: true, prorate: true })`,
 * AND webhook delivery order between that and
 * `customer.subscription.deleted` is not guaranteed. The previous code
 * defaulted to `paymentStatus = "active"` for ANY non-(trialing|past_due)
 * status — including `canceled` and `incomplete_expired`. The race chain
 * that broke: `.deleted` lands first → row goes to "cancelled" →
 * `payment_succeeded` lands → row reverts to "active" → UI shows an
 * Active badge for a cancelled user. Exactly the stranded-row failure
 * PR #67's client-side defensive collapse was supposed to mask
 * (Inspector Brad PR #69 medium-severity find).
 */
function deriveInvoicePaidStatus(
  status: Stripe.Subscription.Status,
): string | null {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    // canceled, incomplete, incomplete_expired, unpaid, paused — none
    // of these mean "the user is now actively billing because an
    // invoice succeeded". For all of them, the invoice is either a
    // final prorated cancellation receipt or a race against another
    // state-changing event — don't overwrite the row.
    default:
      return null;
  }
}

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

  const paymentStatus = deriveInvoicePaidStatus(subscription.status);
  if (paymentStatus === null) {
    // The retrieved subscription is no longer actively billing — most
    // commonly the final prorated invoice from an outbound cancel that
    // already fired `customer.subscription.deleted` (or will fire it
    // shortly). Skip the local update; the deleted handler is
    // authoritative for the terminal state.
    console.log(
      `[stripe:invoice.payment_succeeded] subscription=${subscription.id} status=${subscription.status} is not actively billing — preserving existing row state`,
    );
    return;
  }

  const nextBillingDate = unixSecondsToDate(readCurrentPeriodEnd(subscription));

  await repo.updateById(userSubscription.id, {
    paymentStatus,
    nextBillingDate,
    expiresAt: nextBillingDate,
    trialEndsAt: unixSecondsToDate(subscription.trial_end),
  });
}
