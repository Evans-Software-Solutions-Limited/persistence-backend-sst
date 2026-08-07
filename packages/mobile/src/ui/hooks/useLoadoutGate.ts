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
 * ⚠ **Spec-29 Phase 2 (2026-08-05) flipped `individual_trainer` to `false`.**
 * The entry coach rung (Start Up Coach) deliberately has NO suite — that split is
 * the whole point of the coach-ladder restructure (AC 1.3,
 * `20260805120000_coach_ladder_restructure.sql`). The paid coach tiers
 * (`start_up_coach_plus` / `coach` / `coach_pro`) carry it instead.
 */

/**
 * Mirror of `subscription_tiers.loadout_access`. TOTAL over the union on purpose —
 * a new tier must be classified explicitly rather than defaulting to denied.
 */
const TIER_GRANTS_LOADOUT: Record<SubscriptionTierName, boolean> = {
  free: false,
  premium: false,
  premium_plus: true,
  // ⚠ Spec-29 Phase 2: the entry coach rung LOSES the suite — the no-suite tier
  // is the whole point of the split (AC 1.3,
  // `20260805120000_coach_ladder_restructure.sql`). The paid coach tiers carry it.
  individual_trainer: false,
  start_up_coach_plus: true,
  coach: true,
  coach_pro: true,
};

/**
 * The tier a denied ATHLETE (consumer role) is upsold to. Matches the consumer
 * branch of `pickUpgradeTier`. A denied COACH is upsold to `start_up_coach_plus`
 * by the server verdict's role-aware `upgrade_to`; this consumer default is the
 * fallback the gate sheet renders when no server verdict is present.
 */
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
function isExpiresAtInFuture(expiresAt: string | null, nowMs: number): boolean {
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
  return parsed > nowMs;
}

/**
 * Pure verdict, exported so the branch tree is testable without React Query.
 *
 * `null` subscription means the cache has not resolved. Denied is the safe answer:
 * the alternative is flashing the entry point as unlocked and then 402-ing.
 */
export function computeLoadoutVerdict(
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
  return TIER_GRANTS_LOADOUT[tierName] === true;
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
   * Premium+ monthly price from the live tier API, or null when unavailable.
   * The upsell must never fall back to a literal because database and StoreKit
   * prices can change without an app release.
   */
  readonly upgradePriceMonthly: number | null;
  /** Push the paywall with Premium+ pre-selected. */
  readonly onUpgrade: () => void;
  /**
   * Reissue both underlying queries.
   *
   * ⚠ Exists because `isResolved` cannot see a HUNG request. It covers a
   * rejection, but `getMySubscription` has no client-side timeout, so a half-open
   * socket never settles and React Query's retry never fires — leaving any
   * consumer that renders a spinner while unresolved stuck forever with nothing
   * to reissue.
   *
   * ⚠ **`refetch()` alone is NOT enough, and this is the trap.** TanStack gates
   * `cancelRefetch` on `this.state.data !== undefined` (`query-core/src/query.ts`):
   * with data present it cancels and reissues, but with data UNDEFINED it falls
   * through to `continueRetry()` and hands back **the same hung promise**, issuing
   * nothing at all. Undefined data is by definition the only state this is ever
   * called from — a cold-start fetch that never settled — so a bare `refetch()` is
   * a guaranteed no-op here. The explicit `cancelQueries` first is what makes the
   * subsequent refetch issue anything at all — and it applies to BOTH queries,
   * because the gate is only as unstuck as its slowest half.
   *
   * ⚠ What it abandons is React Query's retryer, NOT the socket. `Query#fetch`
   * does `abortController.abort()` on cancel, but `useMySubscription`'s queryFn
   * calls `api.getMySubscription()` without forwarding `signal`, so nothing is
   * wired to that controller and the half-open connection lingers until the OS
   * times it out. That is fine for this purpose — the point is to stop waiting on
   * it and start a fresh request — but do not read this as transport-level
   * cancellation.
   */
  readonly refetch: () => void;
};

export function useLoadoutGate(enabled = true): LoadoutGate {
  const subQuery = useMySubscription(enabled);
  const tiersQuery = useSubscriptionTiers(enabled);

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

  const queryClient = useQueryClient();
  const refetchSub = subQuery.refetch;
  const refetchTiers = tiersQuery.refetch;
  const refetch = useCallback(() => {
    // Cancel BEFORE refetching — see the `refetch` docstring for why the built-in
    // `cancelRefetch` cannot do it on a first fetch. Prefix key, not the full
    // per-user key, so this does not need the userId.
    // Both halves get the same treatment. `refetchTiers()` on its own hits the
    // identical `data === undefined` gate, so if the CATALOG is the query that
    // hung, a bare refetch there reissues nothing and the upsell sheet renders
    // with no price until the tree remounts.
    void queryClient
      .cancelQueries({ queryKey: [USER_SUBSCRIPTION_QUERY_KEY_PREFIX] })
      .then(() => void refetchSub());
    void queryClient
      .cancelQueries({ queryKey: SUBSCRIPTION_TIERS_QUERY_KEY })
      .then(() => void refetchTiers());
  }, [queryClient, refetchSub, refetchTiers]);

  return useMemo<LoadoutGate>(() => {
    const upgradeTier = tiersQuery.data?.find(
      (tier) => tier.tierName === LOADOUT_UPGRADE_TIER,
    );
    return {
      allowed: computeLoadoutVerdict(subscription, subQuery.accessNowMs),
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
