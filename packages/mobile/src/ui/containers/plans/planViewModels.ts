/**
 * Small, pure view-model helpers shared by the New plan / builder / Add to a
 * meal containers (PER-133, canvas N5). Kept next to the containers because
 * they only shape text for the presenters.
 */
import type {
  Food,
  Meal,
  NutritionEntry,
  Recipe,
} from "@/domain/models/nutrition";
import type {
  NutritionPlan,
  PlanItem,
  PlanMacros,
} from "@/domain/models/nutritionPlans";
import {
  perServingOf,
  planItemFromFood,
  planItemFromRecipe,
  planItemFromSavedMeal,
  planMealsFromDay,
} from "@/domain/services/nutritionPlans.service";
import type { PlanItemRowVM } from "@/ui/presenters/fuel/plans/PlanBuilderPresenter";
import type { MacroShareVM } from "@/ui/presenters/fuel/plans/PlanItemAmountSheetPresenter";

export const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

/** 1 → "1", 1.5 → "1.5", 0.333 → "0.33". */
export function amountText(n: number): string {
  return String(Math.round(n * 100) / 100);
}

const plural = (n: number, one: string, many: string) =>
  `${amountText(n)} ${n === 1 ? one : many}`;

/** "Mine · target 2,371 kcal", or "Mine" without a target. */
export function planSubtitle(targetKcal: number | null): string {
  return targetKcal === null ? "Mine" : `Mine · target ${fmt(targetKcal)} kcal`;
}

/** The serving an amount of 1 means (the amount sheet's Serving size). */
export function servingSizeLabel(item: PlanItem): string {
  if (item.food)
    return `${amountText(item.food.servingSize)} ${item.food.servingUnit}`;
  if (item.kind === "recipe") return "1 portion";
  return "1 serving";
}

/** The grey line under an item (canvas: "Recipe · 1 portion", "1 bar"). */
export function itemSub(item: PlanItem): string {
  const s = item.servings;
  switch (item.kind) {
    case "recipe":
      return `Recipe · ${plural(s, "portion", "portions")}`;
    case "meal":
      return `My meal · ${plural(s, "serving", "servings")}`;
    case "food":
      return item.food
        ? `${amountText(s * item.food.servingSize)} ${item.food.servingUnit}`
        : plural(s, "serving", "servings");
    default:
      return plural(s, "serving", "servings");
  }
}

export function itemRow(item: PlanItem): PlanItemRowVM {
  return {
    id: item.id,
    name: item.name,
    sub: itemSub(item),
    kcal: fmt(item.kcal),
  };
}

/** Each macro's grams and share of the item's calories (N31). */
export function macroShares(m: PlanMacros): MacroShareVM[] {
  const kp = m.proteinG * 4;
  const kc = m.carbsG * 4;
  const kf = m.fatG * 9;
  const total = kp + kc + kf || 1;
  const pct = (k: number) => Math.round((k / total) * 100);
  return [
    { label: "Protein", grams: Math.round(m.proteinG), pct: pct(kp) },
    { label: "Carbs", grams: Math.round(m.carbsG), pct: pct(kc) },
    { label: "Fat", grams: Math.round(m.fatG), pct: pct(kf) },
  ];
}

/** The item's totals at another amount (preview while typing). */
export function macrosAt(item: PlanItem, servings: number): PlanMacros {
  const per = perServingOf(item);
  return {
    kcal: per.kcal * servings,
    proteinG: per.proteinG * servings,
    carbsG: per.carbsG * servings,
    fatG: per.fatG * servings,
  };
}

/** "1.5" / "1,5" / "" → a positive amount, or null. */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type ItemLookups = {
  food: (id: string) => Food | null;
  recipe: (id: string) => Recipe | null;
  meal: (id: string) => Meal | null;
  name: (entry: NutritionEntry) => string;
};

/**
 * A logged entry as a plan item. A food, recipe or saved meal the phone
 * knows becomes a reference with its per-serving macros; anything else keeps
 * the macros it was logged with (the same rule as "A day you logged").
 */
export function planItemFromEntry(
  newId: () => string,
  entry: NutritionEntry,
  lookups: ItemLookups,
): PlanItem {
  const food = entry.foodId ? lookups.food(entry.foodId) : null;
  if (food) return planItemFromFood(newId(), food, entry.servings);
  const recipe =
    !entry.foodId && entry.recipeId ? lookups.recipe(entry.recipeId) : null;
  if (recipe) return planItemFromRecipe(newId(), recipe, entry.servings);
  const meal =
    !entry.foodId && !entry.recipeId && entry.mealId
      ? lookups.meal(entry.mealId)
      : null;
  if (meal) return planItemFromSavedMeal(newId(), meal, entry.servings);
  const [one] = planMealsFromDay(
    {
      date: entry.loggedAt.slice(0, 10),
      targets: null,
      consumed: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, waterCups: 0 },
      remainingKcal: 0,
      entriesBySlot: {
        breakfast: [],
        lunch: [],
        snack: [],
        dinner: [],
        [entry.mealSlot]: [entry],
      },
    },
    [],
    newId,
    () => lookups.name(entry),
  );
  return one.items[0];
}

export function planIsEmpty(plan: NutritionPlan): boolean {
  return plan.meals.every((m) => m.items.length === 0);
}
