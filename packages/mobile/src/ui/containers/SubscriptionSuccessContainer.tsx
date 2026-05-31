import React, { useMemo } from "react";
import { useRouter } from "expo-router";
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

  if (
    tier.includes("trainer") ||
    tier.includes("business") ||
    tier.includes("enterprise")
  ) {
    benefits.push({
      icon: "people",
      title: "Client Management",
      description: "Manage multiple clients and their progress",
    });
  }

  // Post tier-simplification: all surviving trainer tiers carry the
  // former Pro entitlements (AI Buddy etc.). Was `_pro` suffix-checked.
  if (
    tier.includes("trainer") ||
    tier.includes("business") ||
    tier.includes("enterprise")
  ) {
    benefits.push({
      icon: "sparkles",
      title: "AI Analytics & Gym Buddy",
      description:
        "AI supported analytics & Reps Gym Buddy support for personal use & clients",
    });
  }

  return benefits;
}

/** Tier-specific success-alert message, ported from legacy `getSuccessMessage`. */
export function getSuccessMessage(tier: SubscriptionTierName): string {
  if (
    tier.includes("trainer") ||
    tier.includes("business") ||
    tier.includes("enterprise")
  ) {
    return "Your trainer subscription is now active! You can start managing clients and building your fitness business.";
  }
  if (tier === "premium") {
    return "Your premium subscription is now active! Enjoy advanced features and personalized workout recommendations.";
  }
  return "Your subscription is now active! Enjoy all the premium features available to you.";
}

export function SubscriptionSuccessContainer() {
  const router = useRouter();
  const subQuery = useMySubscription();
  const setEligibility = useUserMode((s) => s.setEligibility);
  const switchTo = useUserMode((s) => s.switchTo);
  // Post tier-simplification: 'free' is the safe defensive fallback
  // (basic no longer exists). The success screen only mounts after a
  // successful checkout so subscription data should always be present.
  const tierName: SubscriptionTierName = subQuery.data?.tierName ?? "free";
  const isTrainerTier = subQuery.data?.isTrainerTier ?? false;

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
