import type { MealprintCandidate } from "../../../repositories/mealprintCandidateRepository";
import type { SuggestShape } from "./suggestModel";

/**
 * Mealprint portion policy.
 *
 * Energy correctness and portion plausibility are separate trust boundaries.
 * The database owns macros; this module bounds how much of those macros an AI
 * composition may put on one plate. The model sees these limits in its prompt,
 * and the server enforces the same values after the model returns.
 */

export const MAX_FOOD_SERVINGS = 2;
export const MAX_PRESET_SERVINGS = 2;

/** A normal meal may use modest headroom above its even share of the day. */
export const MEAL_SHARE_HEADROOM = 1.35;
/** Snacks receive half the headroom of a meal share. */
export const SNACK_SHARE_HEADROOM = 0.75;
/** Avoid making low-calorie targets unable to produce a useful plate/snack. */
export const MIN_MEAL_KCAL = 450;
export const MIN_SNACK_KCAL = 250;
/** "Have it" remains over-budget, but cannot become an entire day's intake. */
export const CHEAT_MEAL_DAILY_FRACTION = 0.75;

export function maxMealKcal(input: {
  dailyKcal: number;
  mealsPerDay: number;
  shape?: SuggestShape;
}): number {
  const dailyKcal = Math.max(0, input.dailyKcal);
  const mealsPerDay = Math.max(1, input.mealsPerDay);
  const isSnack = input.shape === "snack";
  const multiplier = isSnack ? SNACK_SHARE_HEADROOM : MEAL_SHARE_HEADROOM;
  const floor = isSnack ? MIN_SNACK_KCAL : MIN_MEAL_KCAL;
  return Math.min(
    dailyKcal,
    Math.max(floor, (dailyKcal / mealsPerDay) * multiplier),
  );
}

export function maxCheatMealKcal(input: {
  dailyKcal: number;
  mealsPerDay: number;
}): number {
  return Math.max(
    maxMealKcal(input),
    Math.max(0, input.dailyKcal) * CHEAT_MEAL_DAILY_FRACTION,
  );
}

export type PortionFailure =
  | { kind: "item"; detail: string }
  | { kind: "meal"; detail: string };

export function assessCompositionPortion(input: {
  items: readonly { candidateId: string; servings: number }[];
  candidates: ReadonlyMap<string, MealprintCandidate>;
  kcalCeiling: number;
}): PortionFailure | null {
  let kcal = 0;
  const servingsByCandidate = new Map<string, number>();
  for (const item of input.items) {
    const candidate = input.candidates.get(item.candidateId);
    if (!candidate) continue;
    const aggregateServings =
      (servingsByCandidate.get(item.candidateId) ?? 0) + item.servings;
    servingsByCandidate.set(item.candidateId, aggregateServings);
    if (aggregateServings > candidate.maxServings) {
      return {
        kind: "item",
        detail: `${item.candidateId}:servings=${aggregateServings}>${candidate.maxServings}`,
      };
    }
    kcal += candidate.kcal * item.servings;
  }

  if (kcal > input.kcalCeiling) {
    return {
      kind: "meal",
      detail: `kcal=${Math.round(kcal)}>${Math.round(input.kcalCeiling)}`,
    };
  }
  return null;
}
