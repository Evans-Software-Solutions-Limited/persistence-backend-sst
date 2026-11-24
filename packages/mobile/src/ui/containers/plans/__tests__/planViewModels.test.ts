import type { NutritionEntry } from "@/domain/models/nutrition";
import { FOOD, MEAL, RECIPE } from "./planFixtures";
import {
  emptyPlanMeal,
  newDraftPlan,
  planItemCustom,
  planItemFromFood,
  planItemFromRecipe,
  planItemFromSavedMeal,
} from "@/domain/services/nutritionPlans.service";
import {
  amountText,
  itemRow,
  itemSub,
  macroShares,
  macrosAt,
  parseAmount,
  planIsEmpty,
  planItemFromEntry,
  planSubtitle,
  servingSizeLabel,
} from "../planViewModels";

const entry = (extra: Partial<NutritionEntry>): NutritionEntry => ({
  id: "e1",
  userId: "u",
  foodId: null,
  recipeId: null,
  mealId: null,
  mealSlot: "lunch",
  servings: 1,
  kcal: 300,
  proteinG: 10,
  carbsG: 30,
  fatG: 10,
  loggedAt: "2026-11-22T12:00:00.000Z",
  loggedByUserId: null,
  aiEstimated: false,
  aiConfidence: null,
  customName: "Soup",
  userMealId: null,
  ...extra,
});

let n = 0;
const newId = () => `id-${++n}`;
const lookups = {
  food: (id: string) => (id === FOOD.id ? FOOD : null),
  recipe: (id: string) => (id === RECIPE.id ? RECIPE : null),
  meal: (id: string) => (id === MEAL.id ? MEAL : null),
  name: (e: NutritionEntry) => e.customName ?? "Logged food",
};

describe("planViewModels", () => {
  it("formats amounts, subtitles and parses typed amounts", () => {
    expect(amountText(1)).toBe("1");
    expect(amountText(1 / 3)).toBe("0.33");
    expect(planSubtitle(2371)).toBe("Mine · target 2,371 kcal");
    expect(planSubtitle(null)).toBe("Mine");
    expect(parseAmount(" 1,5 ")).toBe(1.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("describes each kind of item", () => {
    const food = planItemFromFood("a", FOOD, 2);
    const recipe = planItemFromRecipe("b", RECIPE, 1);
    const meal = planItemFromSavedMeal("c", MEAL, 2);
    const custom = planItemCustom("d", "Apple", {
      kcal: 72,
      proteinG: 0,
      carbsG: 19,
      fatG: 0,
    });
    expect(itemSub(food)).toBe("2 bar");
    expect(itemSub(recipe)).toBe("Recipe · 1 portion");
    expect(itemSub({ ...recipe, servings: 2 })).toBe("Recipe · 2 portions");
    expect(itemSub(meal)).toBe("My meal · 2 servings");
    expect(itemSub(custom)).toBe("1 serving");
    expect(itemSub({ ...food, food: null })).toBe("2 servings");
    expect(servingSizeLabel(food)).toBe("1 bar");
    expect(servingSizeLabel(recipe)).toBe("1 portion");
    expect(servingSizeLabel(custom)).toBe("1 serving");
    expect(itemRow(recipe)).toEqual({
      id: "b",
      name: RECIPE.name,
      sub: "Recipe · 1 portion",
      kcal: "612",
    });
  });

  it("previews macros at an amount and splits calories by macro", () => {
    const food = planItemFromFood("a", FOOD, 1);
    expect(macrosAt(food, 1.5).kcal).toBeCloseTo(297);
    const shares = macroShares({
      kcal: 100,
      proteinG: 10,
      carbsG: 10,
      fatG: 0,
    });
    expect(shares).toEqual([
      { label: "Protein", grams: 10, pct: 50 },
      { label: "Carbs", grams: 10, pct: 50 },
      { label: "Fat", grams: 0, pct: 0 },
    ]);
    expect(
      macroShares({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 })[0].pct,
    ).toBe(0);
  });

  it("turns a logged entry into a plan item", () => {
    expect(
      planItemFromEntry(newId, entry({ foodId: "f1", servings: 2 }), lookups),
    ).toMatchObject({
      kind: "food",
      foodId: "f1",
      kcal: 396,
    });
    expect(
      planItemFromEntry(newId, entry({ recipeId: "r1" }), lookups),
    ).toMatchObject({
      kind: "recipe",
      kcal: 612,
    });
    expect(
      planItemFromEntry(newId, entry({ mealId: "m1" }), lookups),
    ).toMatchObject({
      kind: "meal",
      kcal: 520,
    });
    // Unknown food keeps its logged macros as a reference.
    expect(
      planItemFromEntry(newId, entry({ foodId: "zz" }), lookups),
    ).toMatchObject({
      kind: "food",
      foodId: "zz",
      kcal: 300,
      name: "Soup",
    });
    expect(planItemFromEntry(newId, entry({}), lookups)).toMatchObject({
      kind: "custom",
      name: "Soup",
      kcal: 300,
    });
  });

  it("knows an empty plan", () => {
    const plan = newDraftPlan({
      id: "p",
      ownerId: "u",
      name: "x",
      meals: [emptyPlanMeal("m", "Lunch", "lunch", 0)],
      now: "2026-11-23T00:00:00.000Z",
    });
    expect(planIsEmpty(plan)).toBe(true);
  });
});
