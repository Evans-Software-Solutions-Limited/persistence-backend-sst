import {
  DIETARY_PATTERN_LABELS,
  isDietaryPattern,
  MAX_MEALS_PER_DAY,
  MAX_PLAN_ITEM_SERVINGS,
  MAX_STEER_LENGTH,
  MIN_MEALS_PER_DAY,
  MIN_PLAN_ITEM_SERVINGS,
  recomputePlanMealTotals,
  type MealprintPreferences,
  type NotWantedMeal,
  type PlanDraft,
  type PlanGenerateMealSlot,
  type PlanGeneratedMeal,
  type PlanSwapMeal,
} from "@/domain/models/mealprint";
import type { LogEntryInput, NutritionEntry } from "@/domain/models/nutrition";
import { USER_MEAL_NAME_MAX, type UserMeal } from "@/domain/models/userMeals";
import {
  activeUserMeals,
  defaultUserMealIdForSlot,
  groupEntriesByUserMeal,
  logTargetForUserMeal,
} from "./userMeals.service";

/**
 * Mealprint's whole-day builder (PER-134, canvas N19–N22): portions, the
 * swap panel's feedback, "Log all today" and its Undo. Pure.
 */

// -- Portions (N19: tap a meal's name for portion 0.25–2) ---------------------

export const MEAL_PORTION_MIN = 0.25;
export const MEAL_PORTION_MAX = 2;
export const MEAL_PORTION_STEP = 0.25;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * True when every item of `meal` stays inside the server's per-item servings
 * band (0.25–2) at `factor`. The accept call rejects anything outside it, so
 * the stepper stops there.
 */
export function canScalePlanMeal(
  meal: PlanGeneratedMeal,
  factor: number,
): boolean {
  if (factor < MEAL_PORTION_MIN || factor > MEAL_PORTION_MAX) return false;
  return meal.items.every((item) => {
    const servings = round2(item.servings * factor);
    return (
      servings >= MIN_PLAN_ITEM_SERVINGS && servings <= MAX_PLAN_ITEM_SERVINGS
    );
  });
}

/** The meal at `factor` × its generated portion, totals recomputed. */
export function scalePlanMeal(
  meal: PlanGeneratedMeal,
  factor: number,
): PlanGeneratedMeal {
  if (factor === 1) return meal;
  return recomputePlanMealTotals({
    ...meal,
    items: meal.items.map((item) => ({
      ...item,
      servings: round2(item.servings * factor),
    })),
  });
}

/** The draft as the person sees it: each meal at its chosen portion. */
export function applyPlanPortions(
  draft: PlanDraft,
  portions: Readonly<Record<string, number>>,
): PlanDraft {
  return {
    ...draft,
    meals: draft.meals.map((m) => {
      const factor = portions[m.localId] ?? 1;
      return factor === 1 ? m : { ...m, meal: scalePlanMeal(m.meal, factor) };
    }),
  };
}

// -- Your meals in generation (BE-D3) ------------------------------------------

/**
 * Your meals as `plan-generate` takes them: the first six active meals, in
 * order. Null when there are fewer than two (the call then falls back to
 * `mealsPerDay`).
 */
export function mealsForGenerate(
  userMeals: readonly UserMeal[],
): PlanGenerateMealSlot[] | null {
  const meals = activeUserMeals(userMeals)
    .map((m) => ({
      name: m.name.trim().slice(0, USER_MEAL_NAME_MAX),
      logSlot: m.logSlot,
    }))
    .filter((m) => m.name.length > 0)
    .slice(0, MAX_MEALS_PER_DAY);
  return meals.length >= MIN_MEALS_PER_DAY ? meals : null;
}

/** "Breakfast, Lunch, Dinner, Snacks". */
export function userMealNames(userMeals: readonly UserMeal[]): string {
  return activeUserMeals(userMeals)
    .map((m) => m.name)
    .join(", ");
}

// -- Swap panel (N20) ----------------------------------------------------------

/** The steer chips under the feedback box (canvas N20). */
export const SWAP_STEER_CHIPS = [
  "High protein",
  "Quick to make",
  "Lighter",
  "No fish",
] as const;

/**
 * The swap's `steer`: the ticked chips then the typed feedback, cut to the
 * server's 200 characters. Undefined when there is nothing to say.
 */
export function swapSteer(
  chips: readonly string[],
  text: string,
): string | undefined {
  const parts = [...chips, text.trim()].filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  return parts.join(", ").slice(0, MAX_STEER_LENGTH);
}

/** Meals already shown, in the shape `notWantedMeals` takes. */
export function notWantedFrom(
  meals: readonly (PlanSwapMeal | PlanGeneratedMeal)[],
): NotWantedMeal[] {
  return meals.map((meal) => ({
    name: meal.name,
    ingredients: meal.items.map((item) => item.name),
  }));
}

/** Within ±40 kcal of the current meal the difference is grey, else amber. */
export const SWAP_DELTA_QUIET_KCAL = 40;

/** "+12 kcal", "−40 kcal", "±0 kcal" (canvas N20). */
export function kcalDeltaLabel(delta: number): string {
  const d = Math.round(delta);
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  return `${sign}${Math.abs(d)} kcal`;
}

// -- Log all today (N22) ------------------------------------------------------

/** The meal of Your meals a generated meal goes into. */
export function userMealForGeneratedMeal(
  meal: PlanGeneratedMeal,
  userMeals: readonly UserMeal[],
): UserMeal | null {
  const active = activeUserMeals(userMeals);
  const label = meal.label?.trim().toLowerCase();
  if (label) {
    const byName = active.find((m) => m.name.trim().toLowerCase() === label);
    if (byName) return byName;
  }
  const id = defaultUserMealIdForSlot(active, meal.logSlot);
  return active.find((m) => m.id === id) ?? null;
}

export type LogAllRow = {
  localId: string;
  /** The person's meal ("Breakfast"). */
  mealName: string;
  /** The dish ("Protein oats with berries"). */
  dish: string;
  kcal: number;
  /** True when that meal already had food today, so it was left alone. */
  skipped: boolean;
};

export type LogAllPlan = {
  rows: LogAllRow[];
  /** One entry per item of every meal that is logged. */
  inputs: LogEntryInput[];
};

/**
 * What "Log all today" does: every meal of the day goes into its meal in
 * today's Log, except meals that already have food, which are skipped. Each
 * item is logged by reference (the server re-derives macros); the macros sent
 * are only the phone's optimistic fallback, for the whole portion.
 */
export function planLogAll(
  draft: PlanDraft,
  userMeals: readonly UserMeal[],
  todayEntries: readonly NutritionEntry[],
  loggedAt: string,
): LogAllPlan {
  const groups = groupEntriesByUserMeal(todayEntries, userMeals);
  const withFood = new Set(
    groups.filter((g) => g.entries.length > 0).map((g) => g.meal.id),
  );
  const rows: LogAllRow[] = [];
  const inputs: LogEntryInput[] = [];
  for (const { localId, meal } of draft.meals) {
    const target = userMealForGeneratedMeal(meal, userMeals);
    const mealName = target?.name ?? meal.label ?? meal.name;
    const skipped = target !== null && withFood.has(target.id);
    rows.push({ localId, mealName, dish: meal.name, kcal: meal.kcal, skipped });
    if (skipped) continue;
    const where = target
      ? logTargetForUserMeal(target)
      : { mealSlot: meal.logSlot };
    for (const item of meal.items) {
      const ref =
        item.kind === "recipe"
          ? { recipeId: item.candidateId }
          : item.kind === "meal"
            ? { mealId: item.candidateId }
            : { foodId: item.candidateId };
      inputs.push({
        ...ref,
        ...where,
        servings: item.servings,
        kcal: Math.round(item.kcal * item.servings),
        proteinG: round2(item.proteinG * item.servings),
        carbsG: round2(item.carbsG * item.servings),
        fatG: round2(item.fatG * item.servings),
        customName: item.name,
        loggedAt,
      });
    }
  }
  return { rows, inputs };
}

/** "Breakfast and Snacks", "Breakfast, Lunch and Snacks". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const sameEntry = (a: NutritionEntry, b: NutritionEntry) =>
  a.foodId === b.foodId &&
  a.recipeId === b.recipeId &&
  a.mealId === b.mealId &&
  a.mealSlot === b.mealSlot &&
  a.servings === b.servings &&
  a.loggedAt === b.loggedAt;

/**
 * The ids to delete for Undo. An entry keeps its local id until it syncs,
 * then takes the server's id (in the cache, or on a fresh read). So each
 * logged entry is found by id, else by the same food, meal, servings and
 * time among entries that weren't in the day before "Log all today".
 */
export function resolveLoggedEntryIds(
  before: ReadonlySet<string>,
  logged: readonly NutritionEntry[],
  current: readonly NutritionEntry[],
): string[] {
  const claimed = new Set<string>();
  const ids: string[] = [];
  for (const entry of logged) {
    const match =
      current.find((c) => c.id === entry.id && !claimed.has(c.id)) ??
      current.find(
        (c) => !before.has(c.id) && !claimed.has(c.id) && sameEntry(c, entry),
      );
    if (!match) continue;
    claimed.add(match.id);
    ids.push(match.id);
  }
  return ids;
}

// -- N15 Whole day ---------------------------------------------------------------

/**
 * "Vegetarian · 2 allergens avoided · 3 disliked" for the Food preferences
 * row, or null when nothing is set. Unlike `summarisePreferences` it leaves
 * out meals a day (a day now uses Your meals) and cooking (its own row).
 */
export function preferencesLine(
  preferences: MealprintPreferences | null,
): string | null {
  if (preferences === null) return null;
  const parts: string[] = [];
  const patterns = (preferences.dietaryPatterns ?? []).filter(isDietaryPattern);
  if (patterns.length > 0) {
    parts.push(joinNames(patterns.map((p) => DIETARY_PATTERN_LABELS[p])));
  }
  const allergens = (preferences.avoidAllergens ?? []).length;
  if (allergens > 0) {
    parts.push(`${allergens} allergen${allergens === 1 ? "" : "s"} avoided`);
  }
  const dislikes = (preferences.avoidFoods ?? []).length;
  if (dislikes > 0) parts.push(`${dislikes} disliked`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "Oats · whey ×1.5" — a meal's items in one line. */
export function mealItemsLine(meal: Pick<PlanGeneratedMeal, "items">): string {
  return meal.items
    .map((item) =>
      item.servings === 1 ? item.name : `${item.name} ×${round2(item.servings)}`,
    )
    .join(" · ");
}
