import type Stripe from "stripe";
import { readUserIdFromMetadata } from "./_helpers";

/**
 * Log-only handler for `customer.subscription.trial_will_end`. Stripe
 * fires this 3 days before a trial expires.
 *
 * Legacy comment in stripe-webhook/index.ts line 696:
 *   "TODO: Send notification to user that trial is ending soon"
 *
 * We carry the TODO forward — wiring this into the push-notification
 * pipeline is a separate milestone (M9 trial-reminder push). For now,
 * receiving the event + logging it (so it shows up in CloudWatch when
 * we audit "who got notified about ending trials?") is the minimum
 * useful behavior.
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
  console.log(
    `[stripe:trial_will_end] user=${userId} subscription=${subscription.id} trial_end=${subscription.trial_end ?? "null"} — push-notification wiring deferred to M9`,
  );
}
