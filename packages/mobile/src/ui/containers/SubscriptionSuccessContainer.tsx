import React, { useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { SubscriptionTierName } from "@/domain/models/subscription";
import { useUserMode } from "@/state/user-mode";
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
    benefits.push({
      icon: "sparkles",
      title: "AI Analytics & Gym Buddy",
      description:
        "AI supported analytics & Reps Gym Buddy support for personal use & clients",
    });
  }

  return benefits;
}

/** The tier names that unlock coach mode + the trainer CTA. */
function isTrainerTierName(tier: SubscriptionTierName): boolean {
  return (
    tier.includes("trainer") ||
    tier.includes("business") ||
    tier.includes("enterprise")
  );
}

/** Narrow a raw route param to a known tier name (or null). */
function parseTierParam(raw: string | undefined): SubscriptionTierName | null {
  const known: SubscriptionTierName[] = [
    "free",
    "premium",
    "individual_trainer",
    "small_business",
    "medium_enterprise",
  ];
  return known.find((t) => t === raw) ?? null;
}

/** Tier-specific success-alert message, ported from legacy `getSuccessMessage`. */
export function getSuccessMessage(tier: SubscriptionTierName): string {
  if (isTrainerTierName(tier)) {
    return "Your trainer subscription is now active! You can start managing clients and building your fitness business.";
  }
  if (tier === "premium") {
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
      onGoToHome={() => router.replace("/(app)/(tabs)" as never)}
      onManageClients={onManageClients}
    />
  );
}
