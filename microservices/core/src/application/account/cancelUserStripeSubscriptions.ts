import { SubscriptionRepository } from "../repositories/subscriptionRepository";
import { getStripe } from "../stripe/stripeClient";

/**
 * Detect Stripe errors meaning "the subscription is already cancelled/gone."
 * Mirrors subscriptionsCancelHandler.ts — kept as its own copy (not a shared
 * import) to avoid a circular dep, same rationale as the pre-existing
 * duplication between subscriptionsCancelHandler.ts and
 * eventHandlers/subscriptionUpdated.ts.
 */
function isAlreadyCanceledError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code =
    (err as { code?: unknown }).code ??
    (err as { raw?: { code?: unknown } }).raw?.code;
  if (code === "resource_missing") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /already\s+cancell?ed|has been cancell?ed/i.test(message);
}

/**
 * Cancel EVERY Stripe-billed subscription for the user (08-profile-settings
 * § Revised 2026-06-28; Cluster 2a). Shared between `DELETE /account` (stop
 * billing at the start of the 30-day cooling-off window) and the nightly
 * purge worker (a safety-net re-cancel immediately before the hard purge, in
 * case a sub was created/reactivated during the window).
 *
 * We cancel all rows carrying a Stripe `sub_…` id (not just the newest, and
 * regardless of local payment_status) because a user can have more than one
 * row and a locally-"cancelled" row can still be live on Stripe (the
 * RevenueCat sync flips status without calling Stripe). RevenueCat/Apple IAP
 * subs (`rc_…`) can't be cancelled server-side — the mobile confirm dialog
 * tells the user to cancel in iOS Settings.
 *
 * Throws on a non-recoverable Stripe error so the caller can abort/log before
 * proceeding (the delete handler aborts before soft-deleting; the purge
 * worker logs and skips just this user, per-user isolation).
 */
export async function cancelStripeSubscriptions(userId: string): Promise<void> {
  const subRepo = new SubscriptionRepository();
  const externalIds = await subRepo.findStripeSubscriptionIdsForUser(userId);
  const stripeIds = externalIds.filter((id) => id.startsWith("sub_"));
  if (stripeIds.length === 0) return;

  const stripe = getStripe();
  for (const stripeId of stripeIds) {
    try {
      await stripe.subscriptions.cancel(stripeId);
    } catch (err) {
      if (isAlreadyCanceledError(err)) {
        // Already cancelled on Stripe — idempotent, treat as success.
        continue;
      }
      throw err;
    }
  }
}
