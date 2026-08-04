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
 * ⚠ **`TIER_GRANTS_MEALPRINT` is NOT a copy of `TIER_GRANTS_LOADOUT`, and the
 * difference is the whole point.** `loadout_access` is granted to Premium+ AND
 * all three trainer tiers; `mealprint_access` is granted to **`premium_plus`
 * alone** (`20260803120200_mealprint_access.sql`). Three reasons, all recorded in
 * that migration's header: there is no coach surface in Mealprint v1, repeating
 * Loadout's accepted £14.99-coach/£29.99-athlete price hole would widen it for
 * no product benefit, and `individual_trainer` is already the most cost-exposed
 * tier in the catalogue. Do not "align" the two records.
 *
 * ⚠ That divergence also changes the UPSELL TARGET, which is the trap the backend
 * had to fix. `pickUpgradeTier` used to return `individual_trainer` for a
 * `personal_trainer` BEFORE looking at the feature — so a coach denied `meal_ai`
 * would have been sold a £14.99 tier that still locks them out. Hence
 * `PREMIUM_PLUS_ONLY_FEATURES` server-side, and hence {@link MEALPRINT_UPGRADE_TIER}
 * here being unconditional rather than role-derived.
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
  // ⚠ FALSE for all three trainer tiers, unlike `loadout_access`. See the
  // docstring — this is the considered choice, not an oversight.
  individual_trainer: false,
  small_business: false,
  medium_enterprise: false,
};

/**
 * The tier a denied user is upsold to — **always Premium+, including for a
 * coach.** Matches `pickUpgradeTier`'s `PREMIUM_PLUS_ONLY_FEATURES` branch.
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
function isExpiresAtInFuture(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  const parsed = Date.parse(expiresAt);
  // Explicit rather than incidental: `NaN > x` is already false, so this line
  // changes no behaviour. Kept because it makes the unparseable case legible and
  // keeps this an exact mirror of the server helper and of its twins in
  // `useLoadoutGate` / `useFeatureGate` — which is the only thing that makes
  // "the client gate agrees with the server" checkable by reading.
  if (Number.isNaN(parsed)) return false;
  return parsed > Date.now();
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
): boolean {
  if (subscription === null) return false;
  const entitled =
    ACTIVE_STATUSES.has(subscription.paymentStatus) ||
    (subscription.paymentStatus === "cancelled" &&
      isExpiresAtInFuture(subscription.expiresAt));
  if (!entitled) return false;
  return TIER_GRANTS_MEALPRINT[subscription.tierName] === true;
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
   * Premium+ monthly price from the CATALOG, or null.
   *
   * ⚠ Null is the EXPECTED value until launch: `premium_plus` ships
   * `is_active = false` and `listActive()` returns only active rows, so the tier
   * has no card and no price yet. Every surface must read correctly with no price
   * rather than printing a literal — the retired prototype `£19.99` is exactly
   * how a stale figure survives a reprice (the real number is £29.99).
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
      allowed: computeMealprintVerdict(subscription),
      isResolved,
      upgradePriceMonthly: upgradeTier?.priceMonthly ?? null,
      onUpgrade,
      refetch,
    };
  }, [subscription, isResolved, tiersQuery.data, onUpgrade, refetch]);
}
