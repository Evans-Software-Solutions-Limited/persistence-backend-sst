import { and, inArray } from "drizzle-orm";
import { foods } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { usableFoodForUserCondition } from "../../repositories/foodRepository";
import {
  foodServingScale,
  MealprintCandidateRepository,
} from "../../repositories/mealprintCandidateRepository";
import type {
  MealPlanDTO,
  MealPlanMealDTO,
} from "../../repositories/mealPlanRepository";
import type {
  PlanInput,
  PlanItemInput,
  PlanMealInput,
} from "../../repositories/nutritionPlanRepository";
import { MAX_ITEM_SERVINGS } from "../../repositories/nutritionPlanRepository";

/**
 * PER-119 (Design D, N21) — "Save as a plan": turn one of Mealprint's DATED
 * plans (`meal_plans`) into a list plan (`nutrition_plans`, source
 * `mealprint`) with no dates and no weekdays. The dated plan is only read.
 *
 * Each Mealprint meal becomes one plan meal with the same name (its `label`,
 * cut to the 40 characters a plan meal allows) and slot. Its foods, recipe
 * and saved meal become plan items, so the list plan keeps ingredients and
 * the shopping list working; the plan repository then recomputes every macro
 * from the owner's rows, as for any plan write.
 *
 * ## Recovering servings Mealprint never stored
 *
 * `meal_plan_meals` keeps item servings for foods, but for a recipe or saved
 * meal only the resulting kcal (`nutritionPlansCreateHandler` multiplies one
 * `servings` across both). So the multiplier is recovered exactly the way
 * accept computed it, from the same candidate rows:
 *
 *   m = (meal.kcal − Σ food candidate kcal × servings)
 *       / (recipe per-serving kcal + saved meal kcal)
 *
 * Food servings are converted from Mealprint's serving (the pack serving
 * when declared) to the `foods` row's `serving_size` units the plan uses.
 *
 * ## Deleted sources (Brad, 25 Nov: accepted limitation)
 *
 * The recipe and saved-meal FKs are SET NULL and nothing stored records which
 * sources a meal had at accept, so after a delete "the recipe was deleted"
 * looks the same as "the meal was only ever foods". Guessing from kcal drift
 * would invent food on a routine Open Food Facts refresh, so this doesn't:
 *
 * - All sources gone (no foods left either): the frozen macros are kept as a
 *   one-off item named after the meal.
 * - Recipe or saved meal deleted but foods remain: only the foods are saved;
 *   the deleted part is lost.
 * - One of two backings deleted: the survivor keeps its reconstructed
 *   servings, which then absorb the deleted part's kcal.
 *
 * The journey never deletes a recipe between generating a day and saving it
 * as a plan, so the last two cases shouldn't be hit. Recording each meal's
 * sources at accept would make them exact (needs a migration).
 *
 * A source that still exists but no longer resolves (another owner, or
 * quarantined nutrition) makes the whole save `unavailable`, as logging the
 * meal would (`plan_meal_nutrition_unavailable`).
 */

/** Default name when the app sends none (renamed later with PUT). */
export const MEALPRINT_PLAN_DEFAULT_NAME = "Mealprint";

const MEAL_NAME_MAX = 40;

export type FromMealprintResult =
  | { ok: true; input: PlanInput }
  | { ok: false; error: "unavailable"; items: string[] };

/** Cut to `max` characters without splitting a surrogate pair. */
function cut(value: string, max: number): string {
  return Array.from(value.trim()).slice(0, max).join("").trim();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A servings value the plan repository accepts (0 < s ≤ 100), or null. */
function usableServings(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = round2(Math.min(MAX_ITEM_SERVINGS, value));
  return rounded > 0 ? rounded : null;
}

export async function planInputFromMealprint(
  userId: string,
  plan: MealPlanDTO,
  name: string,
  candidates = new MealprintCandidateRepository(),
): Promise<FromMealprintResult> {
  const foodIds = new Set<string>();
  const recipeIds = new Set<string>();
  const mealIds = new Set<string>();
  for (const meal of plan.meals) {
    for (const item of meal.items ?? []) foodIds.add(item.foodId);
    if (meal.recipeId) recipeIds.add(meal.recipeId);
    if (meal.mealId) mealIds.add(meal.mealId);
  }

  const resolved = await candidates.resolveByIds(userId, {
    foodIds: [...foodIds],
    recipeIds: [...recipeIds],
    mealIds: [...mealIds],
  });
  const byKey = new Map(resolved.map((c) => [`${c.kind}:${c.id}`, c]));
  const required = [
    ...[...foodIds].map((id) => `food:${id}`),
    ...[...recipeIds].map((id) => `recipe:${id}`),
    ...[...mealIds].map((id) => `meal:${id}`),
  ];
  const missing = required.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    return { ok: false, error: "unavailable", items: missing };
  }

  const scaleByFood = new Map<string, number>();
  if (foodIds.size > 0) {
    const rows = await getDb()
      .select({
        id: foods.id,
        servingSize: foods.servingSize,
        servingQuantity: foods.servingQuantity,
      })
      .from(foods)
      .where(
        and(
          inArray(foods.id, [...foodIds]),
          usableFoodForUserCondition(userId),
        ),
      );
    for (const row of rows)
      scaleByFood.set(row.id, foodServingScale(row).scale);
  }

  const meals: PlanMealInput[] = plan.meals.map((meal, index) =>
    toPlanMeal(meal, index, byKey, scaleByFood),
  );
  return { ok: true, input: { name, notes: null, meals } };
}

function toPlanMeal(
  meal: MealPlanMealDTO,
  index: number,
  byKey: Map<string, { kcal: number }>,
  scaleByFood: Map<string, number>,
): PlanMealInput {
  const items: PlanItemInput[] = [];
  let foodKcal = 0;
  for (const item of meal.items ?? []) {
    const candidate = byKey.get(`food:${item.foodId}`)!;
    foodKcal += candidate.kcal * item.servings;
    const servings = usableServings(
      item.servings * (scaleByFood.get(item.foodId) ?? 1),
    );
    if (servings !== null) items.push({ foodId: item.foodId, servings });
  }

  const recipe = meal.recipeId ? byKey.get(`recipe:${meal.recipeId}`) : null;
  const saved = meal.mealId ? byKey.get(`meal:${meal.mealId}`) : null;
  if (recipe || saved) {
    const perMultiplier = (recipe?.kcal ?? 0) + (saved?.kcal ?? 0);
    const multiplier =
      usableServings(
        perMultiplier > 0 ? (meal.kcal - foodKcal) / perMultiplier : 1,
      ) ?? 1;
    // Backing first, as Mealprint lists it: the dish, then extra foods.
    const backing: PlanItemInput[] = [];
    if (recipe)
      backing.push({ recipeId: meal.recipeId!, servings: multiplier });
    if (saved) backing.push({ mealId: meal.mealId!, servings: multiplier });
    items.unshift(...backing);
  }

  const name = cut(meal.label, MEAL_NAME_MAX) || defaultMealName(meal.logSlot);
  if (items.length === 0) {
    // Every source was deleted since accept: keep the frozen macros.
    items.push({
      custom: {
        name: cut(meal.label, 200) || name,
        kcal: meal.kcal,
        proteinG: meal.proteinG,
        carbsG: meal.carbsG,
        fatG: meal.fatG,
      },
      servings: 1,
    });
  }
  return {
    name,
    logSlot: meal.logSlot,
    sortOrder: index,
    items: items.map((item, sortOrder) => ({ ...item, sortOrder })),
  };
}

/** The default Your meals names, for a meal whose label is blank. */
function defaultMealName(slot: MealPlanMealDTO["logSlot"]): string {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}
