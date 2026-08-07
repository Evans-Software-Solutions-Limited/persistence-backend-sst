import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { router, type Href } from "expo-router";
import type {
  BillingCycle,
  MySubscription,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import {
  USER_SUBSCRIPTION_QUERY_KEY_PREFIX,
  useMySubscription,
} from "@/ui/hooks/useMySubscription";
import {
  SUBSCRIPTION_TIERS_QUERY_KEY,
  useSubscriptionTiers,
} from "@/ui/hooks/useSubscriptionTiers";

/**
 * useMealprintGate — the client-side Premium+ verdict for the Mealprint entry
 * points (spec-26 § 3, decision 2 / AC 3.6).
 *
 * Structurally the twin of `useLoadoutGate`, and everything that hook's docstring
 * says about *why* it mirrors a migration instead of reading a joined flag
 * applies verbatim: `/subscriptions/me` does not project `mealprint_access`
 * either (`subscriptionRepository.findForUser` selects six tier columns and that
 * is not one of them), and the public catalog endpoint deliberately omits it so
 * the catalog stays readable on a database that has not had the migration.
 *
 * ⚠ **Spec-29 Phase 2 (2026-08-05) made `TIER_GRANTS_MEALPRINT` track
 * `TIER_GRANTS_LOADOUT` exactly.** Before this restructure `mealprint_access`
 * was granted to `premium_plus` alone (`20260803120200_mealprint_access.sql`) —
 * no coach surface existed in Mealprint v1. The coach-ladder restructure adds
 * one: both suite features (`loadout` + `meal_ai`) are now granted to the same
 * set — `premium_plus` plus the three PAID coach tiers (`start_up_coach_plus` /
 * `coach` / `coach_pro`) — with the entry rung `individual_trainer` carrying
 * neither. See `20260805120000_coach_ladder_restructure.sql`.
 *
 * ⚠ That change also simplified the UPSELL TARGET. Backend `pickUpgradeTier`
 * used to need a `PREMIUM_PLUS_ONLY_FEATURES` split because `loadout` and
 * `meal_ai` upsold differently for a `personal_trainer` (one had a trainer
 * upsell, the other didn't). Now that both suite features have a valid coach
 * upsell (`start_up_coach_plus`), that split is retired server-side; this hook's
 * {@link MEALPRINT_UPGRADE_TIER} stays the unconditional CONSUMER fallback, same
 * as `useLoadoutGate`'s `LOADOUT_UPGRADE_TIER`.
 *
 * ⚠ **When `mealprintAccess` is added to `/subscriptions/me`, delete
 * `TIER_GRANTS_MEALPRINT` and read `subscription.mealprintAccess`.** Four lines
 * of backend (repository projection + `MySubscription` type + this mirror); left
 * out only because this slice is mobile-only.
 *
 * **No taster.** Design § 5.2 is a hard gate: there is no free code path and no
 * preview of real output. Comps and time-boxed promotions arrive as RevenueCat
 * promotional entitlements through the existing webhook, which this hook sees as
 * an ordinary Premium+ grant and needs no code for.
 */

/**
 * Mirror of `subscription_tiers.mealprint_access`. TOTAL over the union on
 * purpose — a new tier is a compile error here rather than a silent denial, so a
 * future B2B seat tier (M21) has to be classified deliberately.
 */
const TIER_GRANTS_MEALPRINT: Record<SubscriptionTierName, boolean> = {
  free: false,
  premium: false,
  premium_plus: true,
  // ⚠ Spec-29 Phase 2: Mealprint now tracks `loadout_access` exactly — the paid
  // coach tiers carry the suite, the entry rung does not. The former
  // "premium_plus-only" split is gone (`20260805120000_coach_ladder_restructure.sql`).
  individual_trainer: false,
  start_up_coach_plus: true,
  coach: true,
  coach_pro: true,
};

/**
 * The tier a denied CONSUMER is upsold to. A denied coach is upsold to
 * `start_up_coach_plus` by the server verdict's role-aware `upgrade_to`; this is
 * the consumer fallback rendered when no server verdict is present. Matches the
 * consumer branch of `pickUpgradeTier`.
 */
export const MEALPRINT_UPGRADE_TIER: SubscriptionTierName = "premium_plus";

const ACTIVE_STATUSES = new Set<MySubscription["paymentStatus"]>([
  "active",
  "trialing",
]);

/**
 * Mirror of the server's `isExpiresInFuture`. A cancelled subscription whose
 * `expires_at` has not passed is still entitled — the user paid through that
 * date and `classifySubscriptionStatus` honours it, so showing them a paywall
 * would be wrong.
 */
function isExpiresAtInFuture(expiresAt: string | null, nowMs: number): boolean {
  if (expiresAt === null) return false;
  const parsed = Date.parse(expiresAt);
  // Explicit rather than incidental: `NaN > x` is already false, so this line
  // changes no behaviour. Kept because it makes the unparseable case legible and
  // keeps this an exact mirror of the server helper and of its twins in
  // `useLoadoutGate` / `useFeatureGate` — which is the only thing that makes
  // "the client gate agrees with the server" checkable by reading.
  if (Number.isNaN(parsed)) return false;
  return parsed > nowMs;
}

/**
 * Pure verdict, exported so the branch tree is testable without React Query.
 *
 * A `null` subscription means the cache has not resolved, and DENIED is the safe
 * answer: the alternative is flashing the entry point as unlocked and then
 * 402-ing. Consumers must therefore distinguish "denied" from "not yet known"
 * via {@link MealprintGate.isResolved} — see `MealprintEntryCard`'s `pending`
 * state for why rendering a padlock here is worse than rendering nothing.
 */
export function computeMealprintVerdict(
  subscription: MySubscription | null,
  nowMs = Date.now(),
): boolean {
  if (subscription === null) return false;
  const tierName = effectiveAdaptiveTier(subscription, nowMs);
  const entitled =
    (ACTIVE_STATUSES.has(subscription.paymentStatus) &&
      (subscription.cancelledAt === null ||
        isExpiresAtInFuture(subscription.expiresAt, nowMs))) ||
    (subscription.paymentStatus === "cancelled" &&
      isExpiresAtInFuture(subscription.expiresAt, nowMs));
  if (!entitled) return false;
  return TIER_GRANTS_MEALPRINT[tierName] === true;
}

function effectiveAdaptiveTier(
  subscription: MySubscription,
  nowMs: number,
): SubscriptionTierName {
  const change = subscription.scheduledChange;
  if (change === null) return subscription.tierName;
  const effectiveMs = Date.parse(change.effectiveAt);
  if (Number.isNaN(effectiveMs) || effectiveMs > nowMs) {
    return subscription.tierName;
  }
  return change.nextTierName;
}

export type MealprintGate = {
  /** True when the entry point should open the flow rather than the upsell. */
  readonly allowed: boolean;
  /**
   * False only while `/subscriptions/me` is still IN FLIGHT.
   *
   * ⚠ An ERRORED query counts as resolved, deliberately. `subscription !== null`
   * alone cannot tell "still loading" from "the query failed", which left
   * Loadout's entry card disabled at 60 % opacity with unlocked copy and no
   * explanation when opened offline. Treating a failure as resolved falls through
   * to the locked/upsell branch, which both says something and is the safer
   * commercial default.
   */
  readonly isResolved: boolean;
  /**
   * Premium+ monthly price from the live tier API, or null when unavailable.
   * Every surface must read correctly without a price rather than printing a
   * literal that can drift from the database or StoreKit.
   */
  readonly upgradePriceMonthly: number | null;
  /** Push the paywall with Premium+ pre-selected. */
  readonly onUpgrade: () => void;
  /**
   * Reissue both underlying queries.
   *
   * ⚠ Exists because `isResolved` cannot see a HUNG request. It covers a
   * rejection, but `getMySubscription` runs with no client-side timeout, so a
   * half-open socket (captive-portal Wi-Fi, dead NAT, a connection dropped while
   * backgrounded) never settles and React Query's retry never fires — leaving any
   * consumer that spins while unresolved stuck forever with nothing to reissue.
   *
   * ⚠ **`refetch()` alone is a guaranteed no-op here, and this has bitten twice.**
   * TanStack gates `cancelRefetch` on `this.state.data !== undefined`
   * (`query-core/src/query.ts`): with data present it cancels and reissues, but
   * with data UNDEFINED it falls through to `continueRetry()` and hands back **the
   * same hung promise**. Undefined data is by definition the only state this is
   * ever called from — a first fetch that never settled — so the explicit
   * `cancelQueries` is what makes the subsequent refetch issue anything at all.
   * It applies to BOTH queries, because the gate is only as unstuck as its
   * slowest half.
   *
   * ⚠ What it abandons is React Query's retryer, NOT the socket.
   * `useMySubscription`'s queryFn does not forward `signal`, so nothing is wired
   * to the abort controller and the half-open connection lingers until the OS
   * times it out. That is fine for this purpose — the point is to stop waiting on
   * it and start a fresh request — but do not read it as transport cancellation.
   */
  readonly refetch: () => void;
};

export function useMealprintGate(): MealprintGate {
  const subQuery = useMySubscription();
  const tiersQuery = useSubscriptionTiers();

  const subscription = subQuery.data ?? null;
  const isResolved = subscription !== null || subQuery.isError;
  const billingCycle: BillingCycle = subscription?.billingCycle ?? "monthly";

  // The `router` SINGLETON, not `useRouter()` — matching `useLoadoutGate`, whose
  // consumers already import the singleton, so no test harness has to mock a
  // hook the component never calls itself.
  const onUpgrade = useCallback(() => {
    router.push(
      `/(auth)/subscription-selection?tier=${MEALPRINT_UPGRADE_TIER}&cycle=${billingCycle}` as Href,
    );
  }, [billingCycle]);

  const queryClient = useQueryClient();
  const refetchSub = subQuery.refetch;
  const refetchTiers = tiersQuery.refetch;
  const refetch = useCallback(() => {
    // Cancel BEFORE refetching — see the `refetch` docstring for why the built-in
    // `cancelRefetch` cannot do it on a first fetch. Prefix key, not the full
    // per-user key, so this does not need the userId.
    void queryClient
      .cancelQueries({ queryKey: [USER_SUBSCRIPTION_QUERY_KEY_PREFIX] })
      .then(() => void refetchSub());
    // The CATALOG half gets the same treatment: it hits the identical
    // `data === undefined` gate, so if it is the query that hung, a bare refetch
    // reissues nothing and the upsell renders with no price until a remount.
    void queryClient
      .cancelQueries({ queryKey: SUBSCRIPTION_TIERS_QUERY_KEY })
      .then(() => void refetchTiers());
  }, [queryClient, refetchSub, refetchTiers]);

  return useMemo<MealprintGate>(() => {
    const upgradeTier = tiersQuery.data?.find(
      (tier) => tier.tierName === MEALPRINT_UPGRADE_TIER,
    );
    return {
      allowed: computeMealprintVerdict(subscription, subQuery.accessNowMs),
      isResolved,
      upgradePriceMonthly: upgradeTier?.priceMonthly ?? null,
      onUpgrade,
      refetch,
    };
  }, [
    subscription,
    isResolved,
    subQuery.accessNowMs,
    tiersQuery.data,
    onUpgrade,
    refetch,
  ]);
}
