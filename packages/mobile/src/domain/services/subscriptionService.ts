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
 * - `premium` → user trial eligibility
 * - `*_pro` (trainer Pro tiers) → trainer trial eligibility
 * - any other tier → never
 *
 * Returns false when eligibility data hasn't loaded yet (legacy
 * comment: "to avoid flickering").
 */
export function shouldShowTrialBanner(
  eligibility:
    | { isEligibleForUserTrial: boolean; isEligibleForTrainerTrial: boolean }
    | null
    | undefined,
  tierName: SubscriptionTierName,
): boolean {
  if (!eligibility) return false;
  if (tierName === "premium") return eligibility.isEligibleForUserTrial;
  if (tierName.endsWith("_pro")) return eligibility.isEligibleForTrainerTrial;
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
