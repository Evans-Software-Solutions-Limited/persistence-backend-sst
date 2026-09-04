import { SubscriptionRepository } from "../repositories/subscriptionRepository";
import { fetchCustomerSubscriptions } from "./revenueCatClient";
import { pickDesiredSubscription } from "./entitlements";
import { lockReferralAttribution } from "../referrals/lockReferralAttribution";

/**
 * Reconcile a single RevenueCat customer's `user_subscriptions` row from the
 * authoritative live-entitlements snapshot (RevenueCat REST). Shared by:
 *  - the webhook handler (on any RevenueCat event — at-least-once, unordered),
 *  - `POST /subscriptions/sync` (client-triggered after purchase/restore, so
 *    the DB reflects the entitlement WITHOUT waiting on the async webhook).
 *
 * `appUserId` is the RevenueCat `app_user_id`, which the app binds to the
 * Supabase user id via `Purchases.logIn` — so it doubles as `profiles.id`.
 * Never trusts a caller-supplied entitlement; always re-fetches from REST.
 */

/**
 * What a sync actually did, so a caller can react to the outcome.
 *
 * Only `revoked` is currently consumed — the webhook handler uses it to notify a
 * user whose subscription was transferred AWAY, and it needs to distinguish
 * "this user just lost a live subscription" from "this user never had one". The
 * `skipped` cases matter for the same reason: an anonymous App User ID or a
 * foreign-environment id must not be treated as a revocation.
 */
export type RevenueCatSyncOutcome =
  | "activated"
  | "revoked"
  | "already_inactive"
  | "skipped";

export function isRevenueCatAnonymousId(appUserId: string): boolean {
  return appUserId.startsWith("$RCAnonymousID:");
}

export async function syncRevenueCatCustomer(
  appUserId: string,
): Promise<RevenueCatSyncOutcome> {
  if (isRevenueCatAnonymousId(appUserId)) {
    console.warn(
      `[revenuecat:sync] skipping anonymous app_user_id (no identity bind yet): ${appUserId}`,
    );
    return "skipped";
  }

  const repo = new SubscriptionRepository();

  // Shared-RevenueCat-project guard: one RC project behind both staging and
  // production fans every event out to every webhook, so this backend may be
  // pinged for a user that only exists in the OTHER environment's database.
  // `user_subscriptions.user_id` FKs to `profiles.id`, so writing a foreign id
  // would throw and 500-loop on RevenueCat's retries forever. Skip it (the
  // event is a no-op success) — only this environment's own users get a row.
  if (!(await repo.userExists(appUserId))) {
    console.warn(
      `[revenuecat:sync] skipping app_user_id with no matching profile (likely a different environment on a shared RevenueCat project): ${appUserId}`,
    );
    return "skipped";
  }

  const rcExternalId = `rc_${appUserId}`;
  const outcome = await repo.withUserSubscriptionLock(
    appUserId,
    async (transaction): Promise<RevenueCatSyncOutcome> => {
      // Take the shared mutation lock before the authoritative fetch. This
      // makes an in-flight active sync visible as serialization intent: a
      // pending founding redemption cannot slip between the RC snapshot and
      // its local mirror write.
      const subscriptions = await fetchCustomerSubscriptions(appUserId);
      const desired = pickDesiredSubscription(subscriptions);

      if (desired !== null) {
        // Cosmetic "cancelled but active" flag: auto-renew OFF while still in the
        // paid period, read from the same subscriptions snapshot. Drives the in-app
        // "cancelled — active until X" banner. `cancelledAt` is set to now when off
        // (the banner only needs it non-null; the date shown is `expiresAt`), and
        // cleared when auto-renew is back on so an uncancellation removes the flag.
        const autoRenewOff = desired.autoRenewOff;

        const values = {
          tierName: desired.tier,
          paymentStatus: "active",
          expiresAt: desired.expiresAt,
          billingCycle: desired.billingCycle,
          cancelledAt: autoRenewOff ? new Date() : null,
          externalSubscriptionId: rcExternalId,
          metadata: {
            source: "revenuecat",
            store: desired.store,
            product_id: desired.productId,
          } as Record<string, unknown>,
        };

        // Supersede ANY other live row for this user before the active write so we
        // never leave two live rows (the `user_subscriptions_active_unique` partial
        // index allows one). This MUST run even though the upsert below re-activates
        // the rc_ mirror: the mirror may be `cancelled` while a sibling row (e.g. a
        // Stripe-created mirror) is still live — re-activating the mirror without
        // first cancelling the sibling would trip that index → 500 → RevenueCat
        // retries forever. RevenueCat is the unifying source of truth across both
        // rails, so a prior live row is safely superseded. Cancelling then
        // re-activating the rc_ row itself (when it was already live) is a harmless
        // extra write reconciled by the upsert's DO UPDATE.
        await repo.cancelLiveSubscriptions(appUserId, transaction);

        // Single ATOMIC upsert on external_subscription_id (spec-12.13). Replaces
        // the former non-atomic findByExternalId→insert-or-update: under
        // RevenueCat's at-least-once + unordered delivery, two concurrent FIRST
        // deliveries for the same new customer both saw `existing === null` and both
        // inserted, tripping the active-unique index (loser 500'd → retry). The
        // partial unique index now makes the second writer take DO UPDATE instead.
        await repo.upsertByExternalId(
          {
            userId: appUserId,
            startsAt: new Date(),
            ...values,
          },
          transaction,
        );
        return "activated";
      }

      // No active entitlement → revert to free by cancelling the live mirror.
      // Keep this write under the same lock as the fetch so every RevenueCat
      // reconciliation has one linearized per-user mutation boundary.
      return (await repo.cancelLiveByExternalId(rcExternalId, transaction))
        ? "revoked"
        : "already_inactive";
    },
  );

  if (outcome === "activated") {
    // FOUNDING-OFFER D5: a live store subscription is a paid conversion, so
    // the user's referral attribution (if any) freezes here. Best-effort —
    // never fails the sync.
    await lockReferralAttribution(appUserId);
  }
  return outcome;
}
