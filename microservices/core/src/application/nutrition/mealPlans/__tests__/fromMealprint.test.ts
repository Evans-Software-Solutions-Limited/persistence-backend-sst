import { describe, expect, it, vi } from "vitest";

/**
 * PER-119 — the edge branches of turning a Mealprint day into a list plan.
 * The happy path, isolation and replay run against the real migrations in
 * `mealPlans.integration.test.ts`; here the candidate reads are faked.
 */

const foodRows = vi.hoisted(() => ({
  rows: [] as {
    id: string;
    servingSize: string;
    servingQuantity: string | null;
  }[],
}));
vi.mock("@persistence/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: async () => foodRows.rows }),
    }),
  }),
}));

import { planInputFromMealprint } from "../fromMealprint";
import type {
  MealPlanDTO,
  MealPlanMealDTO,
} from "../../../repositories/mealPlanRepository";

const FOOD = "11111111-1111-4111-8111-111111111111";
const RECIPE = "22222222-2222-4222-8222-222222222222";
const MEAL = "33333333-3333-4333-8333-333333333333";

function meal(over: Partial<MealPlanMealDTO>): MealPlanMealDTO {
  return {
    id: "m",
    sortOrder: 0,
    label: "Lunch bowl",
    logSlot: "lunch",
    recipeId: null,
    mealId: null,
    items: null,
    kcal: 500,
    proteinG: 40,
    carbsG: 50,
    fatG: 10,
    aiReason: null,
    state: "planned",
    loggedEntryId: null,
    ...over,
  };
}

function plan(meals: MealPlanMealDTO[]): MealPlanDTO {
  return { id: "p", meals } as MealPlanDTO;
}

function candidates(rows: { kind: string; id: string; kcal: number }[]) {
  return { resolveByIds: vi.fn(async () => rows) } as never;
}

describe("planInputFromMealprint", () => {
  it("shares one multiplier across a recipe and a saved meal on one row", async () => {
    const result = await planInputFromMealprint(
      "u",
      plan([meal({ recipeId: RECIPE, mealId: MEAL, kcal: 1200 })]),
      "Day",
      candidates([
        { kind: "recipe", id: RECIPE, kcal: 400 },
        { kind: "meal", id: MEAL, kcal: 200 },
      ]),
    );
    expect(result).toEqual({
      ok: true,
      input: {
        name: "Day",
        notes: null,
        meals: [
          {
            name: "Lunch bowl",
            logSlot: "lunch",
            sortOrder: 0,
            items: [
              { recipeId: RECIPE, servings: 2, sortOrder: 0 },
              { mealId: MEAL, servings: 2, sortOrder: 1 },
            ],
          },
        ],
      },
    });
  });

  it("falls back to 1 serving when the foods already cover the meal's kcal", async () => {
    foodRows.rows = [{ id: FOOD, servingSize: "100", servingQuantity: null }];
    const result = await planInputFromMealprint(
      "u",
      plan([
        meal({
          recipeId: RECIPE,
          items: [{ foodId: FOOD, servings: 2 }],
          kcal: 500,
        }),
      ]),
      "Day",
      candidates([
        { kind: "food", id: FOOD, kcal: 300 },
        { kind: "recipe", id: RECIPE, kcal: 250 },
      ]),
    );
    expect(result.ok && result.input.meals[0].items).toEqual([
      { recipeId: RECIPE, servings: 1, sortOrder: 0 },
      { foodId: FOOD, servings: 2, sortOrder: 1 },
    ]);
  });

  it("skips a zero-serving food and names a blank label after its slot", async () => {
    foodRows.rows = [];
    const result = await planInputFromMealprint(
      "u",
      plan([
        meal({
          label: "   ",
          logSlot: "dinner",
          items: [{ foodId: FOOD, servings: 0 }],
          kcal: 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
        }),
      ]),
      "Day",
      candidates([{ kind: "food", id: FOOD, kcal: 300 }]),
    );
    expect(result.ok && result.input.meals[0]).toEqual({
      name: "Dinner",
      logSlot: "dinner",
      sortOrder: 0,
      items: [
        {
          custom: { name: "Dinner", kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
          servings: 1,
          sortOrder: 0,
        },
      ],
    });
  });

  it("caps servings at the plan maximum", async () => {
    const result = await planInputFromMealprint(
      "u",
      plan([meal({ mealId: MEAL, kcal: 1_000_000 })]),
      "Day",
      candidates([{ kind: "meal", id: MEAL, kcal: 100 }]),
    );
    expect(result.ok && result.input.meals[0].items[0]).toEqual({
      mealId: MEAL,
      servings: 100,
      sortOrder: 0,
    });
  });

  it("adds nothing when an OFF refresh lowered a foods-only meal's food", async () => {
    // Accepted at 2 × 250 kcal; the food row now says 200.
    foodRows.rows = [{ id: FOOD, servingSize: "100", servingQuantity: null }];
    const result = await planInputFromMealprint(
      "u",
      plan([meal({ items: [{ foodId: FOOD, servings: 2 }], kcal: 500 })]),
      "Day",
      candidates([{ kind: "food", id: FOOD, kcal: 200 }]),
    );
    expect(result.ok && result.input.meals[0].items).toEqual([
      { foodId: FOOD, servings: 2, sortOrder: 0 },
    ]);
  });

  it("saves only the foods when the recipe was deleted (documented limitation)", async () => {
    // A 600-kcal recipe + 200-kcal rice; the recipe was deleted, so its
    // recipe_id is NULL and the row looks like a foods-only meal.
    foodRows.rows = [{ id: FOOD, servingSize: "100", servingQuantity: null }];
    const result = await planInputFromMealprint(
      "u",
      plan([meal({ items: [{ foodId: FOOD, servings: 1 }], kcal: 800 })]),
      "Day",
      candidates([{ kind: "food", id: FOOD, kcal: 200 }]),
    );
    expect(result.ok && result.input.meals[0].items).toEqual([
      { foodId: FOOD, servings: 1, sortOrder: 0 },
    ]);
  });

  it("keeps the surviving backing when one of two was deleted (documented limitation)", async () => {
    // Accepted as 1 × recipe (400) + 1 × saved meal (200) = 600; the saved
    // meal was deleted, so the recipe's reconstructed servings absorb it.
    const result = await planInputFromMealprint(
      "u",
      plan([meal({ recipeId: RECIPE, kcal: 600 })]),
      "Day",
      candidates([{ kind: "recipe", id: RECIPE, kcal: 400 }]),
    );
    expect(result.ok && result.input.meals[0].items).toEqual([
      { recipeId: RECIPE, servings: 1.5, sortOrder: 0 },
    ]);
  });

  it("reports every source that no longer resolves", async () => {
    const result = await planInputFromMealprint(
      "u",
      plan([
        meal({ recipeId: RECIPE, items: [{ foodId: FOOD, servings: 1 }] }),
        meal({ mealId: MEAL }),
      ]),
      "Day",
      candidates([]),
    );
    expect(result).toEqual({
      ok: false,
      error: "unavailable",
      items: [`food:${FOOD}`, `recipe:${RECIPE}`, `meal:${MEAL}`],
    });
  });
});
