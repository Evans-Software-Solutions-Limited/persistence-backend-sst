import React, { useMemo } from "react";
import { useRouter } from "expo-router";
import type { SubscriptionTierName } from "@/domain/models/subscription";
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

  if (tier.endsWith("_pro")) {
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
  if (tier === "basic") {
    return "Your basic subscription is now active! Start tracking your workouts and monitoring your progress.";
  }
  return "Your subscription is now active! Enjoy all the premium features available to you.";
}

export function SubscriptionSuccessContainer() {
  const router = useRouter();
  const subQuery = useMySubscription();
  const tierName: SubscriptionTierName = subQuery.data?.tierName ?? "basic";
  const isTrainerTier = subQuery.data?.isTrainerTier ?? false;

  const successMessage = useMemo(() => getSuccessMessage(tierName), [tierName]);
  const benefits = useMemo(() => getSubscriptionBenefits(tierName), [tierName]);

  return (
    <SubscriptionSuccessPresenter
      successMessage={successMessage}
      benefits={benefits}
      isTrainerTier={isTrainerTier}
      onGoToHome={() => router.replace("/(app)/(tabs)" as never)}
      onManageClients={() => router.replace("/(app)/(tabs)/clients" as never)}
    />
  );
}
