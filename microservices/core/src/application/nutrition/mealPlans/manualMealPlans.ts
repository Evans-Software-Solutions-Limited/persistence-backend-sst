import { getDb } from "@persistence/db/client";
import { isActiveTrainer } from "../../coaching/clientProfileRepository";
import { evaluateTogetherEligibility } from "../../entitlement/togetherEligibility";

/**
 * Capability `manual_meal_plans` (Design D, PER-118): creating your OWN list
 * meal plans needs Premium, Premium+ or the trainer role. Coaches plan their
 * own meals free.
 *
 * It gates create only. Receiving, viewing, duplicating and logging a coach's
 * plan need no subscription (PER-12), and an owner can always edit, archive or
 * shop from plans they already have (a Free client's duplicate included).
 *
 * "A live paid tier" is the same rule Together uses
 * (`evaluateTogetherEligibility`: the latest subscription row, lapse and
 * scheduled-change aware, on any paid non-org catalogue tier), so the two
 * gates can't disagree about who is paying.
 */
export const MANUAL_MEAL_PLANS = "manual_meal_plans";

export async function canCreateManualMealPlans(
  userId: string,
): Promise<boolean> {
  if (await isActiveTrainer(userId)) return true;
  return evaluateTogetherEligibility(getDb(), userId);
}

export const MANUAL_MEAL_PLANS_DENIED = {
  error: MANUAL_MEAL_PLANS,
  message: "Creating your own meal plans needs Premium or Premium+",
} as const;
