import { toGrams } from "../../../../recipes/services/units";
import type { PlanMealItem } from "../../../../repositories/mealPlanRepository";
import {
  mapCategoryTagsToAisle,
  SHOPPING_AISLES,
  type ShoppingAisle,
} from "./aisleMap";

/**
 * Mealprint (spec-26 amendment §B.3) — day-scoped shopping list, derived on
 * read from one accepted plan's exploded meals. Nothing is stored.
 *
 * Pure: every row this needs is passed in by
 * `MealPlanRepository.getShoppingSource`, so the aggregation and
 * aisle-grouping logic here is fully testable without a DB — same posture as
 * `avoidanceFilter`.
 */

export type ShoppingSourceMeal = {
  /** The plan meal's OWN denormalised kcal (`meal_plan_meals.kcal`). */
  kcal: number;
  recipeId: string | null;
  mealId: string | null;
  items: PlanMealItem[] | null;
};

export type ShoppingRecipeIngredientRow = {
  recipeId: string;
  foodId: string | null;
  /** Free-text ingredient name, present only when `foodId` is null. */
  customName: string | null;
  quantity: number;
  unit: string;
};

export type ShoppingMealItemRow = {
  mealId: string;
  foodId: string | null;
  /**
   * A nested recipe inside a saved meal. NOT exploded further — the
   * amendment scopes `meal_items` explosion to `foodId + servings` only (see
   * `deriveShoppingList`'s doc comment). Carried through so the caller can
   * see it was present, but this derivation ignores it.
   */
  recipeId: string | null;
  servings: number;
};

export type ShoppingFoodRow = {
  id: string;
  name: string;
  servingSize: number;
  servingUnit: string;
  servingQuantity: number | null;
  categoryTags: string[] | null;
};

/** `recipes.totalKcal` is nullable — a recipe that has never been materialised. */
export type ShoppingRecipeTotal = { id: string; totalKcal: number | null };
/** `meals.totalKcal` is `NOT NULL` in the schema, unlike a recipe's. */
export type ShoppingMealTotal = { id: string; totalKcal: number };

export type ShoppingListSource = {
  planId: string;
  meals: ShoppingSourceMeal[];
  recipeIngredients: ShoppingRecipeIngredientRow[];
  mealItems: ShoppingMealItemRow[];
  foods: ShoppingFoodRow[];
  recipeTotals: ShoppingRecipeTotal[];
  mealTotals: ShoppingMealTotal[];
};

export type ShoppingListItem = {
  id: string;
  name: string;
  quantity: string;
};

export type ShoppingListAisleGroup = {
  aisle: ShoppingAisle;
  items: ShoppingListItem[];
};

export type ShoppingListResponse = {
  planId: string;
  aisles: ShoppingListAisleGroup[];
  totalItems: number;
};

const MASS_VOLUME_UNITS = new Set([
  "g",
  "gram",
  "grams",
  "kg",
  "kilogram",
  "kilograms",
  "ml",
  "milliliter",
  "milliliters",
  "millilitre",
  "millilitres",
  "l",
  "liter",
  "liters",
  "litre",
  "litres",
  "oz",
  "ounce",
  "ounces",
  "lb",
  "lbs",
  "pound",
  "pounds",
]);

function normaliseUnit(unit: string): string {
  return unit.trim().toLowerCase();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatAmount(n: number): string {
  const rounded = round1(n);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * A human quantity string from a food's own serving vocabulary. Mass/volume
 * units (`g`, `ml`, `kg`, `oz`, …) render with no space, matching how OFF/UI
 * already display them (`"350g"`); anything else (a count unit like `egg`,
 * `slice`) renders as `"<amount> <unit>"`.
 *
 * ⚠ Uses `servingSize`/`servingUnit` only. `servingQuantity` (the real pack
 * size, e.g. 220 g for a 100 g-basis OFF row) is a display/scale hint for a
 * SINGLE pack on the scan sheet, not a unit this derivation needs: the total
 * amount needed across a plan is unambiguous in grams/millilitres without it.
 * Flagged rather than silently used for a "N packs" figure the amendment
 * didn't specify.
 */
function formatFoodQuantity(
  totalServings: number,
  food: ShoppingFoodRow,
): string {
  const amount = totalServings * food.servingSize;
  const unit = normaliseUnit(food.servingUnit);
  if (MASS_VOLUME_UNITS.has(unit)) {
    return `${formatAmount(amount)}${food.servingUnit}`;
  }
  return `${formatAmount(amount)} ${food.servingUnit}`;
}

function formatCustomQuantity(quantity: number, unit: string): string {
  const normalised = normaliseUnit(unit);
  if (MASS_VOLUME_UNITS.has(normalised)) {
    return `${formatAmount(quantity)}${unit}`;
  }
  return `${formatAmount(quantity)} ${unit}`;
}

/** Accumulates "servings of this food" across every meal in the plan. */
class FoodServingsAcc {
  private readonly byFoodId = new Map<string, number>();

  add(foodId: string, servings: number): void {
    if (!Number.isFinite(servings)) return;
    this.byFoodId.set(foodId, (this.byFoodId.get(foodId) ?? 0) + servings);
  }

  entries(): [string, number][] {
    return [...this.byFoodId.entries()];
  }
}

/** Accumulates custom-name (no `foodId`) ingredient quantities, keyed by name+unit. */
class CustomItemAcc {
  private readonly byKey = new Map<
    string,
    { name: string; unit: string; quantity: number }
  >();

  add(name: string, unit: string, quantity: number): void {
    if (!Number.isFinite(quantity)) return;
    const key = `${name.trim().toLowerCase()}::${normaliseUnit(unit)}`;
    const existing = this.byKey.get(key);
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.byKey.set(key, { name: name.trim(), unit, quantity });
    }
  }

  entries(): [string, { name: string; unit: string; quantity: number }][] {
    return [...this.byKey.entries()];
  }
}

/**
 * Derive a scale factor for the ingredients/items backing ONE plan meal, from
 * the ratio of the plan meal's stored kcal to the recipe/meal's OWN total
 * kcal.
 *
 * ## Recovering a "servings" multiplier that is never stored
 *
 * `meal_plan_meals` denormalises kcal/macros at accept time
 * (`nutritionPlansCreateHandler`) and does NOT persist the `servings`
 * multiplier the client supplied for a recipe/meal-backed row — only the
 * resulting kcal survives. To scale `recipe_ingredients`/`meal_items`
 * quantities back down to what THIS plan meal actually used (not the whole
 * saved recipe/meal), this uses:
 *
 *   scale = planMeal.kcal / recipe.totalKcal   (recipe-backed)
 *   scale = planMeal.kcal / meal.totalKcal     (meal-backed)
 *
 * This is EXACT when the plan meal is backed by only that recipe/meal (the
 * common case): the accept handler computes `candidate.kcal = totalKcal /
 * servings` then `planMeal.kcal = candidate.kcal * multiplier`, so
 * `planMeal.kcal / totalKcal = multiplier / servings` — precisely the factor
 * that scales a "whole recipe" ingredient quantity (which yields `servings`
 * servings) down to what `multiplier` servings needed.
 *
 * It becomes an APPROXIMATION for the schema-permitted but rare case of a
 * composed meal (recipe/meal PLUS extra `items` in the same row — see the
 * `meal_plan_meals` schema comment: "there is deliberately no XOR check"):
 * the ratio then reflects kcal from every source on the row, not just the
 * recipe/meal's share. Flagged rather than solved — an exact fix needs a
 * stored multiplier, which is a schema change out of this slice's scope.
 *
 * Falls back to 1× (whole recipe/meal, unscaled) when the source total is
 * missing, zero, or non-finite.
 */
function deriveScaleFactor(
  planMealKcal: number,
  sourceTotalKcal: number | null,
): number {
  if (
    sourceTotalKcal === null ||
    !Number.isFinite(sourceTotalKcal) ||
    sourceTotalKcal <= 0 ||
    !Number.isFinite(planMealKcal)
  ) {
    return 1;
  }
  return planMealKcal / sourceTotalKcal;
}

export function deriveShoppingList(
  source: ShoppingListSource,
): ShoppingListResponse {
  const foodsById = new Map(source.foods.map((f) => [f.id, f]));
  const recipeTotalsById = new Map(
    source.recipeTotals.map((r) => [r.id, r.totalKcal]),
  );
  const mealTotalsById = new Map(
    source.mealTotals.map((m) => [m.id, m.totalKcal]),
  );

  const ingredientsByRecipe = new Map<string, ShoppingRecipeIngredientRow[]>();
  for (const row of source.recipeIngredients) {
    const bucket = ingredientsByRecipe.get(row.recipeId);
    if (bucket) bucket.push(row);
    else ingredientsByRecipe.set(row.recipeId, [row]);
  }

  const itemsByMeal = new Map<string, ShoppingMealItemRow[]>();
  for (const row of source.mealItems) {
    const bucket = itemsByMeal.get(row.mealId);
    if (bucket) bucket.push(row);
    else itemsByMeal.set(row.mealId, [row]);
  }

  const foodAcc = new FoodServingsAcc();
  const customAcc = new CustomItemAcc();

  for (const planMeal of source.meals) {
    if (planMeal.recipeId) {
      const scale = deriveScaleFactor(
        planMeal.kcal,
        recipeTotalsById.get(planMeal.recipeId) ?? null,
      );
      for (const ing of ingredientsByRecipe.get(planMeal.recipeId) ?? []) {
        if (ing.foodId) {
          const food = foodsById.get(ing.foodId);
          if (!food) continue; // stale/deleted food row — nothing to show
          const ingGrams = toGrams(ing.quantity, ing.unit);
          const servingGrams = toGrams(food.servingSize, food.servingUnit);
          if (ingGrams !== null && servingGrams !== null && servingGrams > 0) {
            // Exact mass conversion → aggregate in the food's serving unit,
            // keeping the food's name + aisle.
            foodAcc.add(ing.foodId, (ingGrams / servingGrams) * scale);
          } else {
            // Non-mass ingredient unit (cups/tbsp/pieces, or a unitless count):
            // the food's serving unit is the WRONG unit to render this in — the
            // old `servings × servingSize` round-trip printed "2 cups" as "2g"
            // (IB 🟡). Keep the ingredient's own quantity + unit under the food's
            // name instead. Lands in the Other aisle, since a native-unit line
            // isn't a food-serving measure we can slot by category.
            customAcc.add(food.name, ing.unit, ing.quantity * scale);
          }
        } else {
          customAcc.add(
            ing.customName ?? "Ingredient",
            ing.unit,
            ing.quantity * scale,
          );
        }
      }
    }

    if (planMeal.mealId) {
      const scale = deriveScaleFactor(
        planMeal.kcal,
        mealTotalsById.get(planMeal.mealId) ?? null,
      );
      for (const item of itemsByMeal.get(planMeal.mealId) ?? []) {
        // Only `foodId`-backed meal items explode per the amendment's scope
        // (§B.3: "mealId → meal_items: foodId + servings"). A meal item that
        // is itself recipe-backed (`item.recipeId` set, no `foodId`) is
        // skipped — see the doc comment on `ShoppingMealItemRow.recipeId`.
        if (!item.foodId) continue;
        foodAcc.add(item.foodId, item.servings * scale);
      }
    }

    // `items` jsonb servings are ALREADY the exact count consumed for THIS
    // meal (`nutritionPlansCreateHandler` sums `candidate.kcal * item.servings`
    // directly, with no separate multiplier) — no scale factor applies here.
    for (const item of planMeal.items ?? []) {
      foodAcc.add(item.foodId, item.servings);
    }
  }

  const itemsByAisle = new Map<ShoppingAisle, ShoppingListItem[]>();
  const pushItem = (aisle: ShoppingAisle, item: ShoppingListItem) => {
    const bucket = itemsByAisle.get(aisle);
    if (bucket) bucket.push(item);
    else itemsByAisle.set(aisle, [item]);
  };

  for (const [foodId, servings] of foodAcc.entries()) {
    if (servings <= 0) continue;
    const food = foodsById.get(foodId);
    if (!food) continue;
    pushItem(mapCategoryTagsToAisle(food.categoryTags), {
      id: foodId,
      name: food.name,
      quantity: formatFoodQuantity(servings, food),
    });
  }

  for (const [key, agg] of customAcc.entries()) {
    if (agg.quantity <= 0) continue;
    pushItem("Other", {
      id: `custom:${key}`,
      name: agg.name,
      quantity: formatCustomQuantity(agg.quantity, agg.unit),
    });
  }

  const aisles: ShoppingListAisleGroup[] = [];
  let totalItems = 0;
  for (const aisle of SHOPPING_AISLES) {
    const items = itemsByAisle.get(aisle);
    if (!items || items.length === 0) continue;
    const sorted = items.slice().sort((a, b) => a.name.localeCompare(b.name));
    aisles.push({ aisle, items: sorted });
    totalItems += sorted.length;
  }

  return { planId: source.planId, aisles, totalItems };
}
