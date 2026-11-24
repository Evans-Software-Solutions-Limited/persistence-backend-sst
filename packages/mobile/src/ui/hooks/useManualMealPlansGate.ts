import { useMemo } from "react";
import { router, type Href } from "expo-router";
import type { SubscriptionTierName } from "@/domain/models/subscription";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { liveTierName } from "@/ui/hooks/useMealprintGate";

/**
 * PER-133: capability `manual_meal_plans` — making your OWN meal plans needs
 * Premium, Premium+ or a coach tier (the server also lets any active trainer
 * in). It gates New plan only: receiving, viewing, duplicating and logging a
 * coach's plan, and editing plans you already have, need no subscription.
 *
 * Mirrors `canCreateManualMealPlans` on the server; the server is the
 * authority (a create it refuses comes back 403 `manual_meal_plans`).
 */
const TIER_GRANTS_MANUAL_PLANS: Record<SubscriptionTierName, boolean> = {
  free: false,
  premium: true,
  premium_plus: true,
  individual_trainer: true,
  start_up_coach_plus: true,
  coach: true,
  coach_pro: true,
};

export const MANUAL_PLANS_UPGRADE_TIER: SubscriptionTierName = "premium";

export function computeManualPlansVerdict(
  tier: SubscriptionTierName | null,
  isTrainer: boolean,
): boolean {
  if (isTrainer) return true;
  return tier !== null && TIER_GRANTS_MANUAL_PLANS[tier] === true;
}

export type ManualMealPlansGate = {
  allowed: boolean;
  isResolved: boolean;
  onUpgrade: () => void;
};

export function useManualMealPlansGate(): ManualMealPlansGate {
  const sub = useMySubscription();
  const subscription = sub.data ?? null;
  const isResolved = subscription !== null || sub.isError;
  const cycle = subscription?.billingCycle ?? "monthly";
  return useMemo(
    () => ({
      allowed: computeManualPlansVerdict(
        liveTierName(subscription, sub.accessNowMs),
        subscription?.isTrainerTier === true,
      ),
      isResolved,
      onUpgrade: () =>
        router.push(
          `/(auth)/subscription-selection?tier=${MANUAL_PLANS_UPGRADE_TIER}&cycle=${cycle}` as Href,
        ),
    }),
    [subscription, sub.accessNowMs, isResolved, cycle],
  );
}
