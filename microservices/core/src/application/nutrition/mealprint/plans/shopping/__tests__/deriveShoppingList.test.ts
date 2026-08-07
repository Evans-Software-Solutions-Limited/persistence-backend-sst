import { describe, it, expect } from "vitest";
import {
  deriveShoppingList,
  type ShoppingFoodRow,
  type ShoppingListSource,
} from "../deriveShoppingList";

const PLAN_ID = "plan-1";

const CHICKEN: ShoppingFoodRow = {
  id: "food-chicken",
  name: "Chicken breast",
  servingSize: 100,
  servingUnit: "g",
  servingQuantity: null,
  categoryTags: ["en:meats"],
};

const MILK: ShoppingFoodRow = {
  id: "food-milk",
  name: "Milk",
  servingSize: 100,
  servingUnit: "ml",
  servingQuantity: null,
  categoryTags: ["en:milks"],
};

const APPLE: ShoppingFoodRow = {
  id: "food-apple",
  name: "Apple",
  servingSize: 100,
  servingUnit: "g",
  servingQuantity: null,
  categoryTags: ["en:fruits"],
};

/**
 * A source exercising all three explosion paths in one plan (spec-26
 * amendment §B.3): a recipe-backed meal (+ a custom-name ingredient with no
 * food row), a meal-backed meal (+ a nested-recipe item that must NOT
 * explode), and an items-jsonb meal — plus a second items-jsonb meal reusing
 * `CHICKEN` to prove cross-meal aggregation.
 */
function baseSource(): ShoppingListSource {
  return {
    planId: PLAN_ID,
    meals: [
      // Recipe-backed: whole recipe is 800 kcal; this plan meal is 400 kcal
      // → derived scale 0.5.
      { kcal: 400, recipeId: "recipe-1", mealId: null, items: null },
      // Meal-backed: saved meal totals 600 kcal; this plan meal is 300 kcal
      // → derived scale 0.5.
      { kcal: 300, recipeId: null, mealId: "meal-1", items: null },
      // Items-jsonb: servings are already exact, no scaling.
      {
        kcal: 200,
        recipeId: null,
        mealId: null,
        items: [{ foodId: APPLE.id, servings: 2 }],
      },
      {
        kcal: 100,
        recipeId: null,
        mealId: null,
        items: [{ foodId: CHICKEN.id, servings: 1 }],
      },
    ],
    recipeIngredients: [
      {
        recipeId: "recipe-1",
        foodId: CHICKEN.id,
        customName: null,
        quantity: 400,
        unit: "g",
      },
      {
        recipeId: "recipe-1",
        foodId: null,
        customName: "Salt",
        quantity: 5,
        unit: "g",
      },
    ],
    mealItems: [
      {
        mealId: "meal-1",
        foodId: MILK.id,
        recipeId: null,
        servings: 3,
      },
      // Nested-recipe meal item — must be ignored, not silently mis-summed.
      {
        mealId: "meal-1",
        foodId: null,
        recipeId: "nested-recipe-1",
        servings: 1,
      },
    ],
    foods: [CHICKEN, MILK, APPLE],
    recipeTotals: [{ id: "recipe-1", totalKcal: 800 }],
    mealTotals: [{ id: "meal-1", totalKcal: 600 }],
  };
}

describe("deriveShoppingList", () => {
  it("explodes recipe/meal/items-jsonb meals, aggregates by foodId, and groups by aisle", () => {
    const result = deriveShoppingList(baseSource());

    expect(result.planId).toBe(PLAN_ID);
    // Fixed aisle order; empty aisles (Bakery, Cupboard) omitted.
    expect(result.aisles.map((a) => a.aisle)).toEqual([
      "Meat & fish",
      "Dairy & eggs",
      "Fruit & veg",
      "Other",
    ]);

    const meat = result.aisles.find((a) => a.aisle === "Meat & fish")!;
    // 2 servings from the scaled recipe ingredient (400g × 0.5 scale = 200g =
    // 2 servings of a 100g food) + 1 serving from the items-jsonb meal = 3
    // servings × 100g = 300g.
    expect(meat.items).toEqual([
      { id: CHICKEN.id, name: "Chicken breast", quantity: "300g" },
    ]);

    const dairy = result.aisles.find((a) => a.aisle === "Dairy & eggs")!;
    // 3 servings × 0.5 scale = 1.5 servings × 100ml = 150ml. The nested-recipe
    // meal item contributes nothing.
    expect(dairy.items).toEqual([
      { id: MILK.id, name: "Milk", quantity: "150ml" },
    ]);

    const fruitVeg = result.aisles.find((a) => a.aisle === "Fruit & veg")!;
    expect(fruitVeg.items).toEqual([
      { id: APPLE.id, name: "Apple", quantity: "200g" },
    ]);

    const other = result.aisles.find((a) => a.aisle === "Other")!;
    // 5g × 0.5 scale = 2.5g — a custom-name ingredient with no food row.
    expect(other.items).toEqual([
      { id: "custom:salt::g", name: "Salt", quantity: "2.5g" },
    ]);

    expect(result.totalItems).toBe(4);
  });

  it("renders a non-mass recipe ingredient in its own unit under the food's name, not the food's mass unit", () => {
    // IB 🟡: a "2 cups" ingredient linked to a gram-based food used to
    // round-trip through the food's serving and print "2g" in Meat & fish.
    // A non-mass unit must keep its own quantity + unit (grouped by food name).
    const result = deriveShoppingList({
      planId: PLAN_ID,
      meals: [{ kcal: 800, recipeId: "recipe-1", mealId: null, items: null }],
      recipeIngredients: [
        {
          recipeId: "recipe-1",
          foodId: CHICKEN.id,
          customName: null,
          quantity: 2,
          unit: "cups",
        },
      ],
      mealItems: [],
      foods: [CHICKEN],
      recipeTotals: [{ id: "recipe-1", totalKcal: 800 }], // scale 1×
      mealTotals: [],
    });
    // NOT "2g" in the food's mass aisle.
    expect(
      result.aisles.find((a) => a.aisle === "Meat & fish"),
    ).toBeUndefined();
    const other = result.aisles.find((a) => a.aisle === "Other")!;
    const line = other.items.find((i) => i.name === "Chicken breast")!;
    expect(line.quantity).toBe("2 cups");
  });

  it("falls back to an unscaled (1×) recipe when totalKcal is missing", () => {
    const source = baseSource();
    source.recipeTotals = [{ id: "recipe-1", totalKcal: null }];
    // Drop everything except the recipe-backed meal to isolate the fallback.
    source.meals = [
      { kcal: 999, recipeId: "recipe-1", mealId: null, items: null },
    ];
    source.mealItems = [];

    const result = deriveShoppingList(source);
    const meat = result.aisles.find((a) => a.aisle === "Meat & fish")!;
    // Unscaled: 400g ingredient / 100g serving = 4 servings × 100g = 400g.
    expect(meat.items).toEqual([
      { id: CHICKEN.id, name: "Chicken breast", quantity: "400g" },
    ]);
  });

  it("falls back to 1× when the recipe's totalKcal is zero", () => {
    const source = baseSource();
    source.recipeTotals = [{ id: "recipe-1", totalKcal: 0 }];
    source.meals = [
      { kcal: 999, recipeId: "recipe-1", mealId: null, items: null },
    ];
    source.mealItems = [];

    const result = deriveShoppingList(source);
    const meat = result.aisles.find((a) => a.aisle === "Meat & fish")!;
    expect(meat.items).toEqual([
      { id: CHICKEN.id, name: "Chicken breast", quantity: "400g" },
    ]);
  });

  it("falls back to 1× for a meal-backed row when the saved meal's totalKcal is missing", () => {
    const source = baseSource();
    source.mealTotals = []; // meal-1 has no matching totals row at all
    source.meals = [
      { kcal: 999, recipeId: null, mealId: "meal-1", items: null },
    ];
    source.recipeIngredients = [];

    const result = deriveShoppingList(source);
    const dairy = result.aisles.find((a) => a.aisle === "Dairy & eggs")!;
    // Unscaled: 3 servings × 100ml = 300ml.
    expect(dairy.items).toEqual([
      { id: MILK.id, name: "Milk", quantity: "300ml" },
    ]);
  });

  it("treats a recipe-backed meal with no matching recipe_ingredients rows as contributing nothing", () => {
    const source = baseSource();
    source.recipeIngredients = []; // recipe-1 exists but has no ingredient rows
    source.meals = [
      { kcal: 400, recipeId: "recipe-1", mealId: null, items: null },
    ];
    source.mealItems = [];

    const result = deriveShoppingList(source);
    expect(result.aisles).toEqual([]);
  });

  it("treats a meal-backed row with no matching meal_items rows as contributing nothing", () => {
    const source = baseSource();
    source.mealItems = []; // meal-1 exists but has no item rows
    source.meals = [
      { kcal: 300, recipeId: null, mealId: "meal-1", items: null },
    ];
    source.recipeIngredients = [];

    const result = deriveShoppingList(source);
    expect(result.aisles).toEqual([]);
  });

  it("labels a custom ingredient with no customName as 'Ingredient'", () => {
    const source = baseSource();
    source.recipeIngredients = [
      {
        recipeId: "recipe-1",
        foodId: null,
        customName: null,
        quantity: 5,
        unit: "g",
      },
    ];
    source.meals = [
      { kcal: 400, recipeId: "recipe-1", mealId: null, items: null },
    ];
    source.mealItems = [];

    const result = deriveShoppingList(source);
    const other = result.aisles.find((a) => a.aisle === "Other")!;
    expect(other.items).toEqual([
      { id: "custom:ingredient::g", name: "Ingredient", quantity: "2.5g" },
    ]);
  });

  it("drops a food whose aggregated servings net to zero (no line shown)", () => {
    const result = deriveShoppingList({
      planId: PLAN_ID,
      meals: [
        {
          kcal: 100,
          recipeId: null,
          mealId: null,
          items: [{ foodId: CHICKEN.id, servings: 0 }],
        },
      ],
      recipeIngredients: [],
      mealItems: [],
      foods: [CHICKEN],
      recipeTotals: [],
      mealTotals: [],
    });

    expect(result.aisles).toEqual([]);
    expect(result.totalItems).toBe(0);
  });

  it("drops a custom-name ingredient whose scaled quantity nets to zero", () => {
    const result = deriveShoppingList({
      planId: PLAN_ID,
      // kcal 0 against a nonzero recipe total → derived scale factor 0.
      meals: [{ kcal: 0, recipeId: "recipe-1", mealId: null, items: null }],
      recipeIngredients: [
        {
          recipeId: "recipe-1",
          foodId: null,
          customName: "Salt",
          quantity: 5,
          unit: "g",
        },
      ],
      mealItems: [],
      foods: [],
      recipeTotals: [{ id: "recipe-1", totalKcal: 800 }],
      mealTotals: [],
    });

    expect(result.aisles).toEqual([]);
  });

  it("skips an items-jsonb entry whose foodId has no matching food row", () => {
    const result = deriveShoppingList({
      planId: PLAN_ID,
      meals: [
        {
          kcal: 100,
          recipeId: null,
          mealId: null,
          items: [{ foodId: "deleted-food", servings: 2 }],
        },
      ],
      recipeIngredients: [],
      mealItems: [],
      foods: [], // the referenced food no longer exists
      recipeTotals: [],
      mealTotals: [],
    });

    expect(result.aisles).toEqual([]);
    expect(result.totalItems).toBe(0);
  });

  it("ignores a non-finite aggregated food-servings value rather than corrupting the total", () => {
    const result = deriveShoppingList({
      planId: PLAN_ID,
      meals: [
        {
          kcal: 100,
          recipeId: null,
          mealId: null,
          items: [
            { foodId: CHICKEN.id, servings: Number.NaN },
            { foodId: CHICKEN.id, servings: 2 },
          ],
        },
      ],
      recipeIngredients: [],
      mealItems: [],
      foods: [CHICKEN],
      recipeTotals: [],
      mealTotals: [],
    });

    const meat = result.aisles.find((a) => a.aisle === "Meat & fish")!;
    // The NaN contribution is dropped; only the finite `2` servings count.
    expect(meat.items).toEqual([
      { id: CHICKEN.id, name: "Chicken breast", quantity: "200g" },
    ]);
  });

  it("ignores a non-finite custom-ingredient quantity rather than corrupting the total", () => {
    const result = deriveShoppingList({
      planId: PLAN_ID,
      meals: [{ kcal: 400, recipeId: "recipe-1", mealId: null, items: null }],
      recipeIngredients: [
        {
          recipeId: "recipe-1",
          foodId: null,
          customName: "Salt",
          quantity: Number.NaN,
          unit: "g",
        },
      ],
      mealItems: [],
      foods: [],
      recipeTotals: [{ id: "recipe-1", totalKcal: 400 }],
      mealTotals: [],
    });

    expect(result.aisles).toEqual([]);
  });

  it("skips a recipe ingredient whose food row no longer exists", () => {
    const source = baseSource();
    source.foods = source.foods.filter((f) => f.id !== CHICKEN.id);
    source.meals = [
      { kcal: 400, recipeId: "recipe-1", mealId: null, items: null },
    ];
    source.mealItems = [];

    const result = deriveShoppingList(source);
    expect(
      result.aisles.find((a) => a.aisle === "Meat & fish"),
    ).toBeUndefined();
  });

  it("omits every aisle and reports zero items for a plan with no meals", () => {
    const result = deriveShoppingList({
      planId: PLAN_ID,
      meals: [],
      recipeIngredients: [],
      mealItems: [],
      foods: [],
      recipeTotals: [],
      mealTotals: [],
    });

    expect(result.aisles).toEqual([]);
    expect(result.totalItems).toBe(0);
  });

  it("formats a count-unit food (not mass/volume) with a space before the unit", () => {
    const egg: ShoppingFoodRow = {
      id: "food-egg",
      name: "Egg",
      servingSize: 1,
      servingUnit: "egg",
      servingQuantity: null,
      categoryTags: ["en:eggs"],
    };
    const result = deriveShoppingList({
      planId: PLAN_ID,
      meals: [
        {
          kcal: 100,
          recipeId: null,
          mealId: null,
          items: [{ foodId: egg.id, servings: 3 }],
        },
      ],
      recipeIngredients: [],
      mealItems: [],
      foods: [egg],
      recipeTotals: [],
      mealTotals: [],
    });

    const dairy = result.aisles.find((a) => a.aisle === "Dairy & eggs")!;
    expect(dairy.items).toEqual([
      { id: egg.id, name: "Egg", quantity: "3 egg" },
    ]);
  });

  it("formats a custom-name (no food row) ingredient with a count unit with a space", () => {
    const result = deriveShoppingList({
      planId: PLAN_ID,
      meals: [{ kcal: 400, recipeId: "recipe-1", mealId: null, items: null }],
      recipeIngredients: [
        {
          recipeId: "recipe-1",
          foodId: null,
          customName: "Garlic clove",
          quantity: 2,
          unit: "clove",
        },
      ],
      mealItems: [],
      foods: [],
      recipeTotals: [{ id: "recipe-1", totalKcal: 400 }],
      mealTotals: [],
    });

    const other = result.aisles.find((a) => a.aisle === "Other")!;
    expect(other.items).toEqual([
      {
        id: "custom:garlic clove::clove",
        name: "Garlic clove",
        quantity: "2 clove",
      },
    ]);
  });

  it("aggregates two custom-name ingredients that share a name and unit", () => {
    const result = deriveShoppingList({
      planId: PLAN_ID,
      meals: [
        { kcal: 400, recipeId: "recipe-1", mealId: null, items: null },
        { kcal: 400, recipeId: "recipe-2", mealId: null, items: null },
      ],
      recipeIngredients: [
        {
          recipeId: "recipe-1",
          foodId: null,
          customName: "Salt",
          quantity: 5,
          unit: "g",
        },
        {
          recipeId: "recipe-2",
          foodId: null,
          customName: "Salt",
          quantity: 3,
          unit: "g",
        },
      ],
      mealItems: [],
      foods: [],
      recipeTotals: [
        { id: "recipe-1", totalKcal: 400 },
        { id: "recipe-2", totalKcal: 400 },
      ],
      mealTotals: [],
    });

    const other = result.aisles.find((a) => a.aisle === "Other")!;
    expect(other.items).toEqual([
      { id: "custom:salt::g", name: "Salt", quantity: "8g" },
    ]);
  });

  it("sorts items within an aisle alphabetically", () => {
    const zucchini: ShoppingFoodRow = {
      id: "food-zucchini",
      name: "Zucchini",
      servingSize: 100,
      servingUnit: "g",
      servingQuantity: null,
      categoryTags: ["en:vegetables"],
    };
    const asparagus: ShoppingFoodRow = {
      id: "food-asparagus",
      name: "Asparagus",
      servingSize: 100,
      servingUnit: "g",
      servingQuantity: null,
      categoryTags: ["en:vegetables"],
    };
    const result = deriveShoppingList({
      planId: PLAN_ID,
      meals: [
        {
          kcal: 100,
          recipeId: null,
          mealId: null,
          items: [
            { foodId: zucchini.id, servings: 1 },
            { foodId: asparagus.id, servings: 1 },
          ],
        },
      ],
      recipeIngredients: [],
      mealItems: [],
      foods: [zucchini, asparagus],
      recipeTotals: [],
      mealTotals: [],
    });

    const fruitVeg = result.aisles.find((a) => a.aisle === "Fruit & veg")!;
    expect(fruitVeg.items.map((i) => i.name)).toEqual([
      "Asparagus",
      "Zucchini",
    ]);
  });
});
