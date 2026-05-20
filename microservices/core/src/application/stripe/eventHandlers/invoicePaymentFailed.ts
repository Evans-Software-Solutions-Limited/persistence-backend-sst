import type Stripe from "stripe";
import { SubscriptionRepository } from "../../repositories/subscriptionRepository";
import { getStripe } from "../stripeClient";
import { readInvoiceSubscriptionId } from "./_helpers";

/**
 * Handler for `invoice.payment_failed` — Stripe fires this when a
 * recurring charge fails. The user's subscription is moved to
 * `past_due` status, giving them a grace period to update their
 * payment method before Stripe escalates to cancellation (after which
 * we'd see `customer.subscription.deleted`).
 *
 * Legacy stripe-webhook lines 649-685. Same TODO carried forward:
 * notify the user about the failed payment (M9 push milestone).
 *
 * Invoice events carry `subscription` as an id — we fetch the full
 * subscription from Stripe to access metadata.supabase_user_id, then
 * find our local row and stamp `past_due`. If the subscription has no
 * id (one-off invoice unrelated to a sub) we skip cleanly.
 */
export async function handleInvoicePaymentFailed(
  event: Stripe.Event,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  const subscriptionId = readInvoiceSubscriptionId(invoice);
  if (subscriptionId === null) {
    console.log(
      `[stripe:invoice.payment_failed] invoice ${invoice.id} has no subscription — skipping (one-off invoice)`,
    );
    return;
  }

  const subscription = (await getStripe().subscriptions.retrieve(
    subscriptionId,
  )) as Stripe.Subscription;
  const userId = subscription.metadata?.supabase_user_id;
  if (typeof userId !== "string" || userId.length === 0) {
    console.warn(
      `[stripe:invoice.payment_failed] subscription ${subscriptionId} missing supabase_user_id — skipping`,
    );
    return;
  }

  const repo = new SubscriptionRepository();
  const userSubscription = await repo.findByExternalId(subscriptionId);
  if (userSubscription === null) {
    console.warn(
      `[stripe:invoice.payment_failed] no local row for external_subscription_id=${subscriptionId} — skipping`,
    );
    return;
  }

  await repo.updateById(userSubscription.id, {
    paymentStatus: "past_due",
  });

  // TODO(M9): send push notification to the user about the failed payment.
  // The legacy edge function carried the same TODO at line 683 and never
  // shipped it — moving the comment forward so the next milestone can
  // pick it up from the new code path.
  console.log(
    `[stripe:invoice.payment_failed] user=${userId} subscription=${subscriptionId} → past_due (notify TBD M9)`,
  );
}
