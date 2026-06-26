import {
  MEAL_SLOTS,
  entryDisplayLabel,
  heroRingPct,
  macroPct,
  portionToServings,
  type EntryNameLookups,
} from "@/domain/services/nutrition.service";
import type {
  NutritionEntry,
  NutritionTarget,
} from "@/domain/models/nutrition";

const target: NutritionTarget = {
  userId: "u1",
  dailyKcal: 2000,
  proteinG: 150,
  carbsG: 200,
  fatG: 60,
  waterCups: 8,
  preset: "custom",
  setByUserId: null,
  setByName: null,
  updatedAt: null,
};

function entry(over: Partial<NutritionEntry>): NutritionEntry {
  return {
    id: "e1",
    userId: "u1",
    foodId: null,
    recipeId: null,
    mealId: null,
    mealSlot: "breakfast",
    servings: 1,
    kcal: 100,
    proteinG: 10,
    carbsG: 10,
    fatG: 5,
    loggedAt: "2026-03-25T08:00:00.000Z",
    loggedByUserId: null,
    aiEstimated: false,
    aiConfidence: null,
    ...over,
  };
}

describe("nutrition.service Fuel view-model helpers", () => {
  describe("MEAL_SLOTS", () => {
    it("lists the four slots in render order with labels", () => {
      expect(MEAL_SLOTS.map((s) => s.slot)).toEqual([
        "breakfast",
        "lunch",
        "snack",
        "dinner",
      ]);
      expect(MEAL_SLOTS.map((s) => s.label)).toEqual([
        "Breakfast",
        "Lunch",
        "Snack",
        "Dinner",
      ]);
    });
  });

  describe("heroRingPct", () => {
    it("fills as consumed approaches target", () => {
      expect(heroRingPct(target, { kcal: 1000 })).toBeCloseTo(0.5, 5);
    });
    it("clamps to 1 when over target", () => {
      expect(heroRingPct(target, { kcal: 3000 })).toBe(1);
    });
    it("is 0 with no target or non-positive target", () => {
      expect(heroRingPct(null, { kcal: 500 })).toBe(0);
      expect(heroRingPct({ ...target, dailyKcal: 0 }, { kcal: 500 })).toBe(0);
    });
  });

  describe("macroPct", () => {
    it("is consumed/target clamped 0..1", () => {
      expect(macroPct(75, 150)).toBeCloseTo(0.5, 5);
      expect(macroPct(200, 150)).toBe(1);
      expect(macroPct(10, 0)).toBe(0);
    });
  });

  describe("entryDisplayLabel", () => {
    const lookups: EntryNameLookups = {
      food: (id) => (id === "f1" ? "Oatmeal" : undefined),
      recipe: (id) => (id === "r1" ? "Chili" : undefined),
      meal: (id) => (id === "m1" ? "Lunch combo" : undefined),
    };

    it("resolves a food name", () => {
      expect(entryDisplayLabel(entry({ foodId: "f1" }), lookups)).toBe(
        "Oatmeal",
      );
    });
    it("resolves a recipe name", () => {
      expect(entryDisplayLabel(entry({ recipeId: "r1" }), lookups)).toBe(
        "Chili",
      );
    });
    it("resolves a meal name", () => {
      expect(entryDisplayLabel(entry({ mealId: "m1" }), lookups)).toBe(
        "Lunch combo",
      );
    });
    it("falls back to a typed label when the ref isn't cached", () => {
      expect(entryDisplayLabel(entry({ foodId: "x" }), lookups)).toBe(
        "Logged food",
      );
      expect(entryDisplayLabel(entry({ recipeId: "x" }), lookups)).toBe(
        "Recipe",
      );
      expect(entryDisplayLabel(entry({ mealId: "x" }), lookups)).toBe("Meal");
    });
    it("labels a macro-only one-off as Quick entry", () => {
      expect(entryDisplayLabel(entry({}), lookups)).toBe("Quick entry");
    });
  });
});

describe("portionToServings", () => {
  it("serving mode returns the value directly", () => {
    expect(portionToServings({ servingSize: 40 }, "serving", 2)).toBe(2);
  });

  it("grams mode divides by serving size", () => {
    expect(portionToServings({ servingSize: 100 }, "grams", 150)).toBeCloseTo(
      1.5,
      5,
    );
  });

  it("cups mode converts via 245 g/cup", () => {
    expect(portionToServings({ servingSize: 100 }, "cups", 1)).toBeCloseTo(
      2.45,
      5,
    );
  });

  it("falls back to a 100 g basis when serving size is missing (no ~100x over-count)", () => {
    // servingSize 0 → grams treated as per-100g, NOT per-1g.
    expect(portionToServings({ servingSize: 0 }, "grams", 150)).toBeCloseTo(
      1.5,
      5,
    );
    expect(portionToServings({ servingSize: 0 }, "cups", 1)).toBeCloseTo(
      2.45,
      5,
    );
  });
});
