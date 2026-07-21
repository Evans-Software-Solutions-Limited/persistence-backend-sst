import type { FoodDTO } from "../../repositories/foodRepository";
import { servingScaleFactor } from "./units";

export type IngredientInput = {
  foodId?: string | null;
  customName?: string | null;
  quantity: number;
  unit: string;
  sortOrder: number;
};

export type MacroTotals = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/**
 * Server-authoritative recipe/meal totals (STORY-006 AC 6.3) — deterministic,
 * no AI. For each ingredient linked to a food, the contribution is the food's
 * per-serving macros scaled by `servingScaleFactor` — exact gram conversion
 * when both the ingredient and the food serving are mass units, else
 * quantity/servingSize (see units.ts). Ingredients with no `foodId` (free-text
 * customName) contribute 0 — they need a linked food or the whole-recipe AI
 * estimate to carry macros.
 */
export function materialiseTotals(
  ingredients: IngredientInput[],
  foodsById: Map<string, FoodDTO>,
): MacroTotals {
  return ingredients.reduce<MacroTotals>(
    (acc, ing) => {
      if (!ing.foodId) return acc;
      const food = foodsById.get(ing.foodId);
      if (!food || food.servingSize <= 0) return acc;
      const factor = servingScaleFactor(
        ing.quantity,
        ing.unit,
        food.servingSize,
        food.servingUnit,
      );
      return {
        kcal: acc.kcal + food.kcal * factor,
        proteinG: acc.proteinG + food.proteinG * factor,
        carbsG: acc.carbsG + food.carbsG * factor,
        fatG: acc.fatG + food.fatG * factor,
      };
    },
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

/** Round materialised totals to 1 dp to avoid float noise in stored numerics. */
export function roundTotals(t: MacroTotals): MacroTotals {
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    kcal: r(t.kcal),
    proteinG: r(t.proteinG),
    carbsG: r(t.carbsG),
    fatG: r(t.fatG),
  };
}
