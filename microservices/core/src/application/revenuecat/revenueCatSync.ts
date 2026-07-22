import {
  LIVE_SUBSCRIPTION_STATUSES,
  SubscriptionRepository,
} from "../repositories/subscriptionRepository";
import { fetchActiveEntitlements, fetchAutoRenewOff } from "./revenueCatClient";
import { pickDesiredSubscription } from "./entitlements";

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

const LIVE: readonly string[] = LIVE_SUBSCRIPTION_STATUSES;

export function isRevenueCatAnonymousId(appUserId: string): boolean {
  return appUserId.startsWith("$RCAnonymousID:");
}

export async function syncRevenueCatCustomer(appUserId: string): Promise<void> {
  if (isRevenueCatAnonymousId(appUserId)) {
    console.warn(
      `[revenuecat:sync] skipping anonymous app_user_id (no identity bind yet): ${appUserId}`,
    );
    return;
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
    return;
  }

  const entitlements = await fetchActiveEntitlements(appUserId);
  const desired = pickDesiredSubscription(entitlements);

  const rcExternalId = `rc_${appUserId}`;

  if (desired !== null) {
    // Cosmetic "cancelled but active" flag: auto-renew OFF while still in the
    // paid period. Fetched separately (fail-safe → false); drives the in-app
    // "cancelled — active until X" banner. `cancelledAt` is set to now when off
    // (the banner only needs it non-null; the date shown is `expiresAt`), and
    // cleared when auto-renew is back on so an uncancellation removes the flag.
    const autoRenewOff = await fetchAutoRenewOff(appUserId);

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
    await repo.cancelLiveSubscriptions(appUserId);

    // Single ATOMIC upsert on external_subscription_id (spec-12.13). Replaces
    // the former non-atomic findByExternalId→insert-or-update: under
    // RevenueCat's at-least-once + unordered delivery, two concurrent FIRST
    // deliveries for the same new customer both saw `existing === null` and both
    // inserted, tripping the active-unique index (loser 500'd → retry). The
    // partial unique index now makes the second writer take DO UPDATE instead.
    await repo.upsertByExternalId({
      userId: appUserId,
      startsAt: new Date(),
      ...values,
    });
    return;
  }

  // No active entitlement → revert to free by cancelling the live mirror. This
  // branch still needs the row lookup (nothing to cancel if there's no mirror,
  // or the mirror is already terminal).
  const existing = await repo.findByExternalId(rcExternalId);
  if (existing !== null && LIVE.includes(existing.paymentStatus ?? "")) {
    await repo.updateById(existing.id, { paymentStatus: "cancelled" });
  }
}
