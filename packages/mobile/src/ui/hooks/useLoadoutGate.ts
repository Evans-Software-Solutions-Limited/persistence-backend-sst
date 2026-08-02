import { useCallback, useMemo } from "react";
import { router, type Href } from "expo-router";
import type {
  BillingCycle,
  MySubscription,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useSubscriptionTiers } from "@/ui/hooks/useSubscriptionTiers";

/**
 * useLoadoutGate — the client-side Premium+ verdict for the Loadout entry point
 * (spec-21 § 5, AC-9.x).
 *
 * ## ⚠ Why this does NOT read a joined `loadoutAccess` flag, unlike every sibling
 *
 * `useFeatureGate` decides `ai_access` / `gym_buddy` / `trainer_clients` by reading
 * a boolean the server joined onto `MySubscription` from `subscription_tiers`. That
 * is the right pattern and this hook would use it — except **`/subscriptions/me`
 * does not return `loadout_access` today**. `subscriptionRepository.findForUser`
 * projects six tier columns and that is not one of them, and the public catalog
 * endpoint deliberately omits it too (T-P0.9b: `listActive()` has an explicit
 * projection so the catalog stays readable on a database that has not had the
 * Phase-0 migration applied).
 *
 * So the tier set below **mirrors migration `20260725194527_premium_plus_tier`**,
 * which sets `loadout_access = true` for `premium_plus` plus the three trainer
 * tiers. Two things keep that honest:
 *
 * 1. **The server is the gate, not this hook.** `assertEntitlement`'s `loadout`
 *    branch reads the real catalog column, and every Loadout endpoint 402s on a
 *    denial. This verdict exists only so an unentitled user meets an upsell sheet
 *    instead of a failed request — the same division of labour `useFeatureGate`'s
 *    own docstring describes ("a 402 on the mutation is the actual gate").
 * 2. **The Record is total.** Adding a tier to `SubscriptionTierName` is a compile
 *    error here, so a future B2B seat tier (M21) cannot be silently denied — which
 *    is precisely the failure mode design § 5.1 warns a hardcoded check invites.
 *
 * ⚠ **When `loadoutAccess` is added to `/subscriptions/me`, delete `TIER_GRANTS_LOADOUT`
 * and read `subscription.loadoutAccess`.** It is a four-line backend change
 * (repository projection + `MySubscription` type + the mobile mirror) and it was
 * left out of this slice only because the slice is mobile-only.
 *
 * ⚠ **The `individual_trainer` grant is deliberate, not a bug.** All three trainer
 * tiers carry `loadout_access` from the same migration; Brad accepted that on
 * 2026-07-27 (STATE.md § DECIDED). Do not "fix" it here.
 */

/**
 * Mirror of `subscription_tiers.loadout_access`. TOTAL over the union on purpose —
 * a new tier must be classified explicitly rather than defaulting to denied.
 */
const TIER_GRANTS_LOADOUT: Record<SubscriptionTierName, boolean> = {
  free: false,
  premium: false,
  premium_plus: true,
  individual_trainer: true,
  small_business: true,
  medium_enterprise: true,
};

/** The tier a denied athlete is upsold to. Matches `pickUpgradeTier`'s `loadout` branch. */
export const LOADOUT_UPGRADE_TIER: SubscriptionTierName = "premium_plus";

const ACTIVE_STATUSES = new Set<MySubscription["paymentStatus"]>([
  "active",
  "trialing",
]);

/**
 * Mirror of the server's `isExpiresInFuture`. A cancelled subscription whose
 * `expires_at` has not passed is still entitled — the user paid through that date
 * and the server honours it, so showing them a paywall would be wrong.
 */
function isExpiresAtInFuture(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  const parsed = Date.parse(expiresAt);
  // ⚠ EQUIVALENT MUTANT — removing this line changes no behaviour, because
  // `NaN > x` is already false. Kept anyway for two reasons, so a future
  // mutation sweep does not chase it: it makes the unparseable case explicit
  // rather than incidental, and it keeps this an exact mirror of both the
  // server's `isExpiresInFuture` and its sibling in `useFeatureGate.ts`, which
  // is the only thing making "the client gate agrees with the server" checkable
  // by reading.
  if (Number.isNaN(parsed)) return false;
  return parsed > Date.now();
}

/**
 * Pure verdict, exported so the branch tree is testable without React Query.
 *
 * `null` subscription means the cache has not resolved. Denied is the safe answer:
 * the alternative is flashing the entry point as unlocked and then 402-ing.
 */
export function computeLoadoutVerdict(
  subscription: MySubscription | null,
): boolean {
  if (subscription === null) return false;
  const entitled =
    ACTIVE_STATUSES.has(subscription.paymentStatus) ||
    (subscription.paymentStatus === "cancelled" &&
      isExpiresAtInFuture(subscription.expiresAt));
  if (!entitled) return false;
  return TIER_GRANTS_LOADOUT[subscription.tierName] === true;
}

export type LoadoutGate = {
  /** True when the entry point should open the flow rather than the upsell. */
  readonly allowed: boolean;
  /**
   * False only while `/subscriptions/me` is still IN FLIGHT.
   *
   * ⚠ An ERRORED query counts as resolved, and deliberately. `isResolved` began
   * as `subscription !== null`, which cannot tell "still loading" from "the
   * query failed" — so opening a workout offline left the entry card disabled at
   * 60 % opacity with unlocked copy and no explanation, doing nothing on tap.
   * Treating a failure as resolved falls through to the locked/upsell branch,
   * which both says something and is the safer commercial default.
   */
  readonly isResolved: boolean;
  /**
   * Premium+ monthly price from the CATALOG, or null.
   *
   * ⚠ Null is the EXPECTED value until launch. `premium_plus` ships
   * `is_active = false` and `listActive()` only returns active rows, so the tier
   * has no card and no price yet — deliberately (design § 9.1: an active row
   * publishes a buyable card for a feature that does not exist). The upsell sheet
   * must read correctly with no price rather than printing a literal; the
   * prototype's `£19.99` is retired and the real figure is £29.99 in the catalog.
   */
  readonly upgradePriceMonthly: number | null;
  /** Push the paywall with Premium+ pre-selected. */
  readonly onUpgrade: () => void;
};

export function useLoadoutGate(): LoadoutGate {
  const subQuery = useMySubscription();
  const tiersQuery = useSubscriptionTiers();

  const subscription = subQuery.data ?? null;
  const isResolved = subscription !== null || subQuery.isError;
  const billingCycle: BillingCycle = subscription?.billingCycle ?? "monthly";

  // The `router` SINGLETON, not `useRouter()`. Every navigating consumer of this
  // hook (workout detail, the flow overlay) already imports the singleton, and
  // `useRouter` would additionally require each of their test harnesses to mock a
  // hook they never call themselves.
  const onUpgrade = useCallback(() => {
    router.push(
      `/(auth)/subscription-selection?tier=${LOADOUT_UPGRADE_TIER}&cycle=${billingCycle}` as Href,
    );
  }, [billingCycle]);

  return useMemo<LoadoutGate>(() => {
    const upgradeTier = tiersQuery.data?.find(
      (tier) => tier.tierName === LOADOUT_UPGRADE_TIER,
    );
    return {
      allowed: computeLoadoutVerdict(subscription),
      isResolved,
      upgradePriceMonthly: upgradeTier?.priceMonthly ?? null,
      onUpgrade,
    };
  }, [subscription, isResolved, tiersQuery.data, onUpgrade]);
}
