import { describe, it, expect } from "vitest";
import {
  materialiseMealTotals,
  type MealItemInput,
  type RecipeMacroSummary,
} from "../materialiseMealMacros";
import type { FoodDTO } from "../../../repositories/foodRepository";

function food(id: string, over: Partial<FoodDTO> = {}): FoodDTO {
  return {
    id,
    name: "f",
    brand: null,
    barcode: null,
    kcal: 100,
    proteinG: 10,
    carbsG: 20,
    fatG: 5,
    servingSize: 100,
    servingUnit: "g",
    servingQuantity: null,
    source: "user",
    createdBy: null,
    ...over,
  };
}

const item = (o: Partial<MealItemInput>): MealItemInput => ({
  servings: 1,
  sortOrder: 0,
  ...o,
});

describe("materialiseMealTotals", () => {
  it("food item = per-serving macros × servings", () => {
    const out = materialiseMealTotals(
      [item({ foodId: "f1", servings: 2 })],
      new Map([["f1", food("f1")]]),
      new Map(),
    );
    expect(out).toEqual({ kcal: 200, proteinG: 20, carbsG: 40, fatG: 10 });
  });

  it("recipe item = (total / recipe servings) × servings", () => {
    const recipes = new Map<string, RecipeMacroSummary>([
      [
        "r1",
        {
          totalKcal: 800,
          totalProteinG: 40,
          totalCarbsG: 80,
          totalFatG: 20,
          servings: 4,
        },
      ],
    ]);
    const out = materialiseMealTotals(
      [item({ recipeId: "r1", servings: 1 })],
      new Map(),
      recipes,
    );
    // one serving of a 4-serving / 800kcal recipe = 200kcal
    expect(out.kcal).toBe(200);
    expect(out.proteinG).toBe(10);
  });

  it("guards recipe servings of 0 (treats as 1)", () => {
    const recipes = new Map<string, RecipeMacroSummary>([
      [
        "r1",
        {
          totalKcal: 100,
          totalProteinG: 0,
          totalCarbsG: 0,
          totalFatG: 0,
          servings: 0,
        },
      ],
    ]);
    const out = materialiseMealTotals(
      [item({ recipeId: "r1", servings: 1 })],
      new Map(),
      recipes,
    );
    expect(out.kcal).toBe(100);
  });

  it("ignores unresolved references and sums a mixed meal", () => {
    const out = materialiseMealTotals(
      [
        item({ foodId: "f1", servings: 1 }),
        item({ foodId: "missing", servings: 5 }),
        item({ recipeId: "missing", servings: 5 }),
      ],
      new Map([["f1", food("f1", { kcal: 50 })]]),
      new Map(),
    );
    expect(out.kcal).toBe(50);
  });
});
