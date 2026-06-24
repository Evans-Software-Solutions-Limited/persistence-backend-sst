import type { FoodDTO } from "../../repositories/foodRepository";
import type { MacroTotals } from "../../recipes/services/materialiseMacros";

export type MealItemInput = {
  foodId?: string | null;
  recipeId?: string | null;
  servings: number;
  sortOrder: number;
};

/** Per-recipe macro summary (totals are for the whole recipe across its servings). */
export type RecipeMacroSummary = {
  totalKcal: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  servings: number;
};

/**
 * Server-authoritative meal totals (STORY-007). A meal is a saved combination
 * of logged foods / recipes. Each item's `servings` is a count:
 *   - food item     → food's per-serving macros × servings
 *   - recipe item   → recipe's per-serving macros (total / recipe.servings) × servings
 * Unresolved references contribute 0.
 */
export function materialiseMealTotals(
  items: MealItemInput[],
  foodsById: Map<string, FoodDTO>,
  recipesById: Map<string, RecipeMacroSummary>,
): MacroTotals {
  return items.reduce<MacroTotals>(
    (acc, item) => {
      if (item.foodId && foodsById.has(item.foodId)) {
        const f = foodsById.get(item.foodId)!;
        return {
          kcal: acc.kcal + f.kcal * item.servings,
          proteinG: acc.proteinG + f.proteinG * item.servings,
          carbsG: acc.carbsG + f.carbsG * item.servings,
          fatG: acc.fatG + f.fatG * item.servings,
        };
      }
      if (item.recipeId && recipesById.has(item.recipeId)) {
        const r = recipesById.get(item.recipeId)!;
        const div = r.servings > 0 ? r.servings : 1;
        const factor = item.servings / div;
        return {
          kcal: acc.kcal + r.totalKcal * factor,
          proteinG: acc.proteinG + r.totalProteinG * factor,
          carbsG: acc.carbsG + r.totalCarbsG * factor,
          fatG: acc.fatG + r.totalFatG * factor,
        };
      }
      return acc;
    },
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}
