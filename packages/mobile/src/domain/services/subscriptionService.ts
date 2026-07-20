import type {
  MySubscription,
  SubscriptionTierName,
} from "@/domain/models/subscription";

/**
 * Subscription domain services. Pure functions — no framework
 * imports. Ported 1:1 from legacy `persistence-mobile/lib/utils/
 * subscriptionUtils.ts`.
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 * Satisfies: requirements.md AC 3.5, 3.6, 3.7
 */

/**
 * `true` when the user has no row in `user_subscriptions`, OR has
 * a row with `tier_name === 'free'` (synthesised by the backend).
 *
 * Ported from legacy `isFreeTier` — same semantics. Trialing
 * subscriptions of any other tier are NOT free.
 */
export function isFreeTier(
  subscription: MySubscription | null | undefined,
): boolean {
  if (!subscription) return true;
  return subscription.tierName === "free";
}

/**
 * `true` when the subscription is currently providing access:
 * `cancelledAt` is null AND `expiresAt` is in the future.
 *
 * Ported from legacy `isSubscriptionActive`. We rely on the
 * `expiresAt` date rather than a database `is_active` column —
 * `MySubscription` is the joined-and-pre-computed shape returned
 * by `GET /subscriptions/me` and doesn't surface `is_active`. The
 * date check is the same predicate the backend uses under the
 * hood.
 */
export function isSubscriptionActive(
  subscription: MySubscription | null | undefined,
): boolean {
  if (!subscription) return false;
  if (subscription.cancelledAt) return false;
  if (!subscription.expiresAt) return false;
  return new Date(subscription.expiresAt) > new Date();
}

/**
 * `true` when the subscription can be cancelled by the user via
 * the Cancel button. Requires:
 *   - active (or trialing-which-counts-as-active)
 *   - not free tier
 *   - not already cancelled (`cancelledAt` null)
 *
 * Legacy comment: subscription_ends_at can be set for trial
 * subscriptions (trial end date) without being cancelled — so the
 * cancellation indicator is `cancelledAt`, not `expiresAt`.
 */
export function canCancelSubscription(
  subscription: MySubscription | null | undefined,
): boolean {
  if (!subscription) return false;
  return (
    isSubscriptionActive(subscription) &&
    !isFreeTier(subscription) &&
    !subscription.cancelledAt
  );
}

/**
 * `true` when the subscription is currently in `trialing` state.
 * Display-only — use `isSubscriptionActive` for access checks.
 */
export function isTrialing(
  subscription: MySubscription | null | undefined,
): boolean {
  if (!subscription) return false;
  return subscription.paymentStatus === "trialing";
}

/**
 * `true` when the user has cancelled but is still inside their
 * paid period. Used by the Selection screen to show the
 * "Cancelled / Click your plan card to reinstate" indicator
 * (`requirements.md` AC 3.6).
 */
export function isCancelledButActive(
  subscription: MySubscription | null | undefined,
): boolean {
  if (!subscription) return false;
  if (!subscription.cancelledAt) return false;
  if (!subscription.expiresAt) return false;
  return new Date(subscription.expiresAt) > new Date();
}

/**
 * Trial-banner derivation. Mirrors legacy `shouldShowTrialBanner`.
 *
 * - `premium` → user trial eligibility (DEFAULT_TRIAL_DAYS)
 * - Any trainer tier (post tier-simplification — Standards dropped,
 *   `_pro` suffix removed; check is now "is this a known trainer tier
 *   name") → trainer trial eligibility (DEFAULT_TRIAL_DAYS)
 * - `free` → never
 *
 * Returns false when eligibility data hasn't loaded yet (legacy
 * comment: "to avoid flickering").
 */
const TRAINER_TIER_NAMES: ReadonlySet<SubscriptionTierName> = new Set([
  "individual_trainer",
  "small_business",
  "medium_enterprise",
]);

export function shouldShowTrialBanner(
  eligibility:
    | { isEligibleForUserTrial: boolean; isEligibleForTrainerTrial: boolean }
    | null
    | undefined,
  tierName: SubscriptionTierName,
): boolean {
  if (!eligibility) return false;
  if (tierName === "premium") return eligibility.isEligibleForUserTrial;
  if (TRAINER_TIER_NAMES.has(tierName))
    return eligibility.isEligibleForTrainerTrial;
  return false;
}

/**
 * Numeric rank for tiers within a single track. Higher = more
 * entitlements. Used by `tierSatisfies` to decide whether the user's
 * current tier covers a verdict's `upgradeTo`. Cross-track comparisons
 * are NOT supported by this rank — `tierSatisfies` short-circuits on
 * mismatched tracks before reaching the numeric comparison.
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Sync-queue entitlement handling (M10.6) > Tier hierarchy
 * Satisfies: requirements.md AC 12.3, 12.7
 */
const USER_TRACK_RANK: Partial<Record<SubscriptionTierName, number>> = {
  // Post tier-simplification: Basic is gone — Premium is the only paid
  // user tier. Free=0, Premium=1.
  free: 0,
  premium: 1,
};

const TRAINER_TRACK_RANK: Partial<Record<SubscriptionTierName, number>> = {
  // `free` doubles as the no-trainer-tier baseline — a trainer requirement
  // is not satisfied by `free`, so its rank is below any real trainer tier.
  // Trainer tiers ranked by client-slot capacity:
  // Individual < Small Business < Medium / Enterprise.
  free: 0,
  individual_trainer: 1,
  small_business: 2,
  medium_enterprise: 3,
};

/**
 * `true` when a user holding `currentTier` is also entitled to whatever
 * `requiredTier` would grant. Track-aware: user-tier upgrades do NOT
 * satisfy trainer-tier requirements and vice versa — the only
 * inter-track tier is `free`, which satisfies nothing (it's just
 * "no plan").
 *
 * Used by `useAutoRetryOnUpgrade` to decide which blocked entries to
 * unblock when `useMySubscription` reports a tier change. Pure — safe
 * to call inside React effects or as part of a reducer.
 *
 *   tierSatisfies("premium", "basic")          // true  (within user track)
 *   tierSatisfies("basic",   "premium")        // false (lower)
 *   tierSatisfies("premium", "individual_trainer") // false (cross-track)
 *   tierSatisfies("individual_trainer", "individual_trainer") // true
 *   tierSatisfies("free",    "basic")          // false (free satisfies nothing)
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Sync-queue entitlement handling (M10.6) > Tier hierarchy
 * Satisfies: requirements.md AC 12.3, 12.7
 */
export function tierSatisfies(
  currentTier: SubscriptionTierName,
  requiredTier: SubscriptionTierName,
): boolean {
  // Identical tier always satisfies — fast path that also covers `free`
  // vs `free`, where neither rank table contains the row in a way that
  // would meaningfully claim entitlement.
  if (currentTier === requiredTier) return true;

  const requiredOnUserTrack = USER_TRACK_RANK[requiredTier] !== undefined;
  const requiredOnTrainerTrack =
    TRAINER_TRACK_RANK[requiredTier] !== undefined && requiredTier !== "free";

  if (requiredOnUserTrack && requiredTier !== "free") {
    const currentRank = USER_TRACK_RANK[currentTier];
    const requiredRank = USER_TRACK_RANK[requiredTier] ?? 0;
    if (currentRank === undefined) return false;
    return currentRank >= requiredRank;
  }

  if (requiredOnTrainerTrack) {
    const currentRank = TRAINER_TRACK_RANK[currentTier];
    const requiredRank = TRAINER_TRACK_RANK[requiredTier] ?? 0;
    // A user-track tier (basic, premium) has no rank on the trainer
    // table → never satisfies a trainer requirement (AC 12.7).
    if (currentRank === undefined || currentRank === 0) return false;
    return currentRank >= requiredRank;
  }

  // Required tier is `free` (or an unknown future tier) — never satisfies
  // a meaningful upgrade. The auto-retry hook never sees `upgradeTo:
  // "free"` in practice (the backend doesn't gate against free), but be
  // defensive.
  return false;
}

/**
 * Read of a `MySubscription` into display strings + scheduled-change
 * metadata for the Selection screen header. Mirrors legacy
 * `getSubscriptionDisplayInfo`, with the V2 extension that
 * `scheduledChange` is now first-class on the shape (legacy left
 * the scheduled-change fields hardcoded false because it never
 * surfaced them server-side).
 *
 * `tierDisplayNames` is the `tier_name` → `display_name` map built
 * from the tier catalog response.
 */
export function getSubscriptionDisplayInfo(
  subscription: MySubscription | null | undefined,
  tierDisplayNames: Record<string, string>,
): {
  currentTierDisplayName: string;
  hasScheduledChange: boolean;
  nextTierDisplayName: string | null;
  effectiveAt: string | null;
  currentTierActiveUntil: string | null;
} {
  if (!subscription) {
    return {
      currentTierDisplayName: "Free",
      hasScheduledChange: false,
      nextTierDisplayName: null,
      effectiveAt: null,
      currentTierActiveUntil: null,
    };
  }

  const currentTierDisplayName =
    tierDisplayNames[subscription.tierName] ??
    subscription.tierDisplayName ??
    subscription.tierName;

  if (subscription.scheduledChange) {
    return {
      currentTierDisplayName,
      hasScheduledChange: true,
      nextTierDisplayName:
        tierDisplayNames[subscription.scheduledChange.nextTierName] ??
        subscription.scheduledChange.nextDisplayName,
      effectiveAt: subscription.scheduledChange.effectiveAt,
      currentTierActiveUntil: subscription.expiresAt,
    };
  }

  return {
    currentTierDisplayName,
    hasScheduledChange: false,
    nextTierDisplayName: null,
    effectiveAt: null,
    currentTierActiveUntil: subscription.expiresAt,
  };
}
