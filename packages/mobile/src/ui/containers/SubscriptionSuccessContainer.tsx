import React, { useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { SubscriptionTierName } from "@/domain/models/subscription";
import { useUserMode } from "@/state/user-mode";
import { usePendingInvite } from "@/state/pending-invite";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import {
  SubscriptionSuccessPresenter,
  type SubscriptionBenefit,
} from "@/ui/presenters/SubscriptionSuccessPresenter";

/**
 * Post-payment Success container. Ported 1:1 from legacy
 * `persistence-mobile/app/(auth)/success.tsx` lines 51–107.
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 * Satisfies: requirements.md AC 2.6, 6.5
 *
 * Reads useMySubscription to derive the tier-specific benefits list +
 * success message, then routes the user to Home (or to the Clients
 * tab on trainer tiers).
 */

/** Tier-specific benefits, ported from legacy `getSubscriptionBenefits`. */
export function getSubscriptionBenefits(
  tier: SubscriptionTierName,
): SubscriptionBenefit[] {
  const benefits: SubscriptionBenefit[] = [
    {
      icon: "checkmark-circle",
      title: "Unlimited Workouts",
      description: "Create and track unlimited workouts",
    },
  ];

  if (isTrainerTierName(tier)) {
    benefits.push({
      icon: "people",
      title: "Client Management",
      description: "Manage multiple clients and their progress",
    });
  }

  // Post tier-simplification: all surviving trainer tiers carry the
  // former Pro entitlements (AI Buddy etc.). Was `_pro` suffix-checked.
  if (isTrainerTierName(tier)) {
    // Analytics and Gym Buddy both dropped from this copy 2026-07-25
    // (Brad): neither exists. The AI weekly client summary does, so that
    // is what this benefit now describes.
    benefits.push({
      icon: "sparkles",
      title: "AI client insights",
      description: "AI weekly summaries of each client's training and habits",
    });
  }

  return benefits;
}

/**
 * The tier names that unlock coach mode + the trainer CTA.
 *
 * Spec-29 Phase 2 (2026-08-05) retired the `small_business` / `medium_enterprise`
 * business tiers in favour of the coach ladder (`start_up_coach_plus` / `coach` /
 * `coach_pro`), all of which contain "coach" rather than "business" / "enterprise".
 */
function isTrainerTierName(tier: SubscriptionTierName): boolean {
  return tier.includes("trainer") || tier.includes("coach");
}

/**
 * Every tier name, keyed so adding/removing a `SubscriptionTierName` union
 * member is a compile error here — a new purchasable tier can't silently fail
 * to parse and fall back to the (racy) query.
 */
const KNOWN_TIER_NAMES: Record<SubscriptionTierName, true> = {
  free: true,
  premium: true,
  premium_plus: true,
  individual_trainer: true,
  start_up_coach_plus: true,
  coach: true,
  coach_pro: true,
};

/** Narrow a raw route param to a known tier name (or null). */
function parseTierParam(raw: string | undefined): SubscriptionTierName | null {
  if (raw === undefined) return null;
  // Own-property check only — `in` would match inherited keys like "toString".
  return Object.prototype.hasOwnProperty.call(KNOWN_TIER_NAMES, raw)
    ? (raw as SubscriptionTierName)
    : null;
}

/** Tier-specific success-alert message, ported from legacy `getSuccessMessage`. */
export function getSuccessMessage(tier: SubscriptionTierName): string {
  if (isTrainerTierName(tier)) {
    return "Your trainer subscription is now active! You can start managing clients and building your fitness business.";
  }
  if (tier === "premium" || tier === "premium_plus") {
    return "Your premium subscription is now active! Enjoy advanced features and personalized workout recommendations.";
  }
  return "Your subscription is now active! Enjoy all the premium features available to you.";
}

export function SubscriptionSuccessContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tier?: string }>();
  const subQuery = useMySubscription();
  const setEligibility = useUserMode((s) => s.setEligibility);
  const switchTo = useUserMode((s) => s.switchTo);
  // The iOS IAP path passes the just-purchased tier as a route param because
  // its entitlement lands server-side via an ASYNC RevenueCat webhook — the
  // `/subscriptions/me` refetch here usually wins the race against the webhook
  // and would otherwise show the stale (free) tier + hide the trainer CTA.
  // Prefer the param when present; fall back to the query for the Stripe path
  // (which writes the subscription row synchronously, so its read is fresh).
  // Post tier-simplification: 'free' is the safe defensive fallback.
  const purchasedTier = parseTierParam(params.tier);
  const tierName: SubscriptionTierName =
    purchasedTier ?? subQuery.data?.tierName ?? "free";
  const isTrainerTier =
    purchasedTier !== null
      ? isTrainerTierName(purchasedTier)
      : (subQuery.data?.isTrainerTier ?? false);

  const successMessage = useMemo(() => getSuccessMessage(tierName), [tierName]);
  const benefits = useMemo(() => getSubscriptionBenefits(tierName), [tierName]);

  // Under the Option 3 IA, the Clients tab is visible only in coach mode
  // (mode — not subscription tier — gates tab VISIBILITY; 14-navigation
  // locked decision #7). A user who has just paid for a trainer tier is
  // still in the default `athlete` mode, so navigating straight to /clients
  // would land them on a hidden tab with nothing highlighted. Mark them
  // eligible (the purchase just confirmed trainer tier) + switch into coach
  // mode BEFORE navigating, so the coach IA is live when they arrive.
  const onManageClients = () => {
    setEligibility(true);
    void switchTo("coach").finally(() => {
      router.replace("/(app)/(tabs)/clients" as never);
    });
  };

  return (
    <SubscriptionSuccessPresenter
      successMessage={successMessage}
      benefits={benefits}
      isTrainerTier={isTrainerTier}
      onGoToHome={() => {
        // New-user path bypasses AuthGate's post-auth branch (success replaces
        // straight into (app)), so redeem a stashed invite code here too
        // (device-QA #2 follow-up — carry code through signup). Peek (the
        // accept-invite screen clears the stash on arrival); encode the code.
        const pendingCode = usePendingInvite.getState().pendingCode;
        router.replace(
          (pendingCode
            ? `/(app)/accept-invite?code=${encodeURIComponent(pendingCode)}`
            : "/(app)/(tabs)") as never,
        );
      }}
      onManageClients={onManageClients}
    />
  );
}
