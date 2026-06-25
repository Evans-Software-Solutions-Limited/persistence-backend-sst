import { associateStripePurchaseWithRevenueCat } from "../revenuecat/revenueCatClient";

/**
 * Best-effort bind of a Stripe subscription to its Supabase user id in
 * RevenueCat (M12 §3b), called from the Stripe webhook once the userId is
 * known. RevenueCat is the entitlement source of truth across both rails; this
 * ensures a Stripe (web) purchase lands on the SAME RevenueCat customer
 * (keyed on the Supabase user id) as the user's Apple purchases, so the
 * entitlements merge.
 *
 * Deliberately swallows errors: the Stripe DB write is the critical path, and
 * RevenueCat's own Stripe tracking + the `/revenuecat/webhook` re-fetch are the
 * backstops — a RevenueCat hiccup must never fail (and so retry) the Stripe
 * webhook. Logs on failure for observability.
 */
export async function syncStripeSubscriptionToRevenueCat(
  stripeSubscriptionId: string,
  userId: string,
): Promise<void> {
  try {
    await associateStripePurchaseWithRevenueCat(stripeSubscriptionId, userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[stripe→revenuecat] failed to bind ${stripeSubscriptionId} to user=${userId}: ${message}`,
    );
  }
}
