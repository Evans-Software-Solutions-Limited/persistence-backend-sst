import { sql, type SQLWrapper } from "drizzle-orm";
import { foods, mealItems, recipeIngredients } from "@persistence/db";

export class NutritionSourceUnavailableError extends Error {
  readonly items: string[];

  constructor(items: string[]) {
    super("nutrition_source_unavailable");
    this.name = "NutritionSourceUnavailableError";
    this.items = items;
  }
}

export class PlanNutritionUnavailableError extends Error {
  constructor() {
    super("plan_nutrition_unavailable");
    this.name = "PlanNutritionUnavailableError";
  }
}

/**
 * A saved recipe is usable only when none of its linked ingredients is a
 * quarantined OFF row. Custom/free-text ingredients remain usable.
 */
export function recipeNutritionDataIsUsable(recipeId: SQLWrapper) {
  return sql`NOT EXISTS (
    SELECT 1
    FROM ${recipeIngredients} AS trust_ri
    JOIN ${foods} AS trust_rf ON trust_rf.id = trust_ri.food_id
    WHERE trust_ri.recipe_id = ${recipeId}
      AND trust_rf.source = 'openfoodfacts'
      AND trust_rf.nutrition_data_valid = false
  )`;
}

/**
 * A meal can contain foods directly or through a saved recipe. Both paths must
 * fail closed or an old denormalised meal total can bypass food quarantine.
 */
export function mealNutritionDataIsUsable(mealId: SQLWrapper) {
  return sql`NOT EXISTS (
      SELECT 1
      FROM ${mealItems} AS trust_mi
      JOIN ${foods} AS trust_mf ON trust_mf.id = trust_mi.food_id
      WHERE trust_mi.meal_id = ${mealId}
        AND trust_mf.source = 'openfoodfacts'
        AND trust_mf.nutrition_data_valid = false
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ${mealItems} AS trust_mri
      JOIN ${recipeIngredients} AS trust_ri
        ON trust_ri.recipe_id = trust_mri.recipe_id
      JOIN ${foods} AS trust_rf ON trust_rf.id = trust_ri.food_id
      WHERE trust_mri.meal_id = ${mealId}
        AND trust_rf.source = 'openfoodfacts'
        AND trust_rf.nutrition_data_valid = false
    )`;
}
