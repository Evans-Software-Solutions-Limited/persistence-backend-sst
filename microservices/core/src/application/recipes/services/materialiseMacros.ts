import type { FoodDTO } from "../../repositories/foodRepository";

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
 * per-serving macros scaled by (quantity / servingSize) — i.e. quantity is
 * expressed in the food's own serving unit. Ingredients with no `foodId`
 * (free-text customName) contribute 0 in M9 (can't be computed without a food
 * row); the AI auto-estimate path that fills those is deferred to M9.5.
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
      const factor = ing.quantity / food.servingSize;
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
