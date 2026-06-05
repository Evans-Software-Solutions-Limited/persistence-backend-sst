import type Stripe from "stripe";
import { emitStripeAlert } from "../alerts";
import { readUserIdFromMetadata } from "./_helpers";

/**
 * Handler for `customer.subscription.trial_will_end`. Stripe fires this 3
 * days before a trial expires.
 *
 * Emits a `warn` ops alert (spec 17 / Phase C, audit MED-4) so trial-ending
 * is a structured, alertable signal. User-facing trial-reminder push remains
 * the M9 milestone (the notification_type enum + push pipeline don't exist
 * yet) — this is the ops-alert layer, not the customer notification.
 */
export async function handleTrialWillEnd(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const userId = readUserIdFromMetadata(subscription);
  if (userId === null) {
    console.warn(
      `[stripe:trial_will_end] subscription ${subscription.id} missing supabase_user_id metadata — skipping`,
    );
    return;
  }
  emitStripeAlert("trial_will_end", "warn", {
    userId,
    subscriptionId: subscription.id,
    trialEnd: subscription.trial_end ?? null,
  });
  return Promise.resolve();
}
