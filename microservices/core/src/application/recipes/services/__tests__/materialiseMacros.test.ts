import { describe, it, expect } from "vitest";
import {
  materialiseTotals,
  roundTotals,
  type IngredientInput,
} from "../materialiseMacros";
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

const ing = (over: Partial<IngredientInput>): IngredientInput => ({
  quantity: 100,
  unit: "g",
  sortOrder: 0,
  ...over,
});

describe("materialiseTotals", () => {
  it("scales a food's macros by quantity / servingSize", () => {
    const foods = new Map([["f1", food("f1")]]);
    const out = materialiseTotals([ing({ foodId: "f1", quantity: 50 })], foods);
    expect(out).toEqual({ kcal: 50, proteinG: 5, carbsG: 10, fatG: 2.5 });
  });

  it("sums multiple ingredients", () => {
    const foods = new Map([
      ["f1", food("f1", { kcal: 100 })],
      ["f2", food("f2", { kcal: 200 })],
    ]);
    const out = materialiseTotals(
      [
        ing({ foodId: "f1", quantity: 100 }),
        ing({ foodId: "f2", quantity: 100 }),
      ],
      foods,
    );
    expect(out.kcal).toBe(300);
  });

  it("ignores free-text ingredients (no foodId)", () => {
    const out = materialiseTotals(
      [ing({ customName: "pinch of salt", quantity: 1 })],
      new Map(),
    );
    expect(out).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it("ignores a foodId with no matching food or a zero servingSize", () => {
    const foods = new Map([["f1", food("f1", { servingSize: 0 })]]);
    const out = materialiseTotals(
      [
        ing({ foodId: "missing", quantity: 100 }),
        ing({ foodId: "f1", quantity: 100 }),
      ],
      foods,
    );
    expect(out.kcal).toBe(0);
  });
});

describe("roundTotals", () => {
  it("rounds to 1 decimal place", () => {
    expect(
      roundTotals({ kcal: 50.06, proteinG: 5.04, carbsG: 10, fatG: 2.55 }),
    ).toEqual({
      kcal: 50.1,
      proteinG: 5,
      carbsG: 10,
      fatG: 2.6,
    });
  });
});
