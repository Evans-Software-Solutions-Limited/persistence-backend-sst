import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { meals, recipes } from "@persistence/db";
import {
  mealNutritionDataIsUsable,
  recipeNutritionDataIsUsable,
} from "../nutritionDataValidity";

function render(fragment: unknown) {
  return new PgDialect().sqlToQuery(fragment as never);
}

describe("nutrition data validity predicates", () => {
  it("rejects a recipe linked to a quarantined OFF ingredient", () => {
    const { sql } = render(recipeNutritionDataIsUsable(recipes.id));
    expect(sql).toContain('FROM "recipe_ingredients" AS trust_ri');
    expect(sql).toContain('JOIN "foods" AS trust_rf');
    expect(sql).toContain("trust_rf.nutrition_data_valid = false");
    expect(sql).toContain("trust_rf.source = 'openfoodfacts'");
  });

  it("checks both direct foods and nested recipe foods for a saved meal", () => {
    const { sql } = render(mealNutritionDataIsUsable(meals.id));
    expect(sql.match(/FROM "meal_items"/g)).toHaveLength(2);
    expect(sql).toContain('JOIN "foods" AS trust_mf');
    expect(sql).toContain('JOIN "recipe_ingredients" AS trust_ri');
    expect(sql).toContain('JOIN "foods" AS trust_rf');
    expect(sql.match(/nutrition_data_valid = false/g)).toHaveLength(2);
    expect(sql.match(/source = 'openfoodfacts'/g)).toHaveLength(2);
  });
});
