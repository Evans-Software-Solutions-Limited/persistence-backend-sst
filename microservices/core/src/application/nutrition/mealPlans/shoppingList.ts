import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  foods,
  mealItems,
  meals,
  recipeIngredients,
  recipes,
  shoppingListPlans,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  NutritionPlanRepository,
  loadPlanItems,
} from "../../repositories/nutritionPlanRepository";
import { MealPlanRepository } from "../../repositories/mealPlanRepository";
import { isUuid } from "../../repositories/userMealRepository";
import { PlanNutritionUnavailableError } from "../../repositories/nutritionDataValidity";
import { assertEntitlement } from "../../entitlement/assertEntitlement";
import {
  deriveShoppingList,
  type ShoppingListAisleGroup,
  type ShoppingListSource,
} from "../mealprint/plans/shopping/deriveShoppingList";

/**
 * Design D (PER-118) — the shopping list built from the plans the person has
 * added to it (`shopping_list_plans`). Aggregation is Mealprint's
 * `deriveShoppingList`, unchanged: list-plan items are mapped onto its source
 * shape (a food item is a meal of one `{foodId, servings}`; a recipe or saved
 * meal item carries its own kcal so the existing kcal-ratio scaling gives
 * exactly `servings / recipe.servings`). One-off items have no ingredients and
 * add nothing. Ticks stay on the phone (N23).
 *
 * Only plans the person can still read count: a coach plan that was removed
 * drops out, and a Mealprint plan counts only while Mealprint is unlocked
 * (its own shopping route has the same gate).
 */

export type ShoppingPlanRef = {
  nutritionPlanId: string | null;
  mealPlanId: string | null;
  addedAt: string;
};

export type ShoppingListDTO = {
  aisles: ShoppingListAisleGroup[];
  totalItems: number;
  plans: ShoppingPlanRef[];
  asOf: string;
};

const emptySource = (): ShoppingListSource => ({
  planId: "shopping-list",
  meals: [],
  recipeIngredients: [],
  mealItems: [],
  foods: [],
  recipeTotals: [],
  mealTotals: [],
});

export async function buildShoppingList(
  userId: string,
): Promise<ShoppingListDTO> {
  const db = getDb();
  const asOf = new Date().toISOString();
  const refs = await db
    .select()
    .from(shoppingListPlans)
    .where(eq(shoppingListPlans.userId, userId))
    .orderBy(asc(shoppingListPlans.addedAt));

  const repo = new NutritionPlanRepository();
  const source = emptySource();
  const counted: ShoppingPlanRef[] = [];

  const readablePlanIds: string[] = [];
  for (const ref of refs) {
    if (!ref.nutritionPlanId) continue;
    if (await repo.getReadable(userId, ref.nutritionPlanId)) {
      readablePlanIds.push(ref.nutritionPlanId);
      counted.push({
        nutritionPlanId: ref.nutritionPlanId,
        mealPlanId: null,
        addedAt: ref.addedAt.toISOString(),
      });
    }
  }

  const items = await loadPlanItems(db, readablePlanIds);
  const recipeIds = [
    ...new Set(items.map((i) => i.recipeId).filter(Boolean)),
  ] as string[];
  const mealIds = [
    ...new Set(items.map((i) => i.mealId).filter(Boolean)),
  ] as string[];
  for (const item of items) {
    const kcal = Number(item.kcal);
    if (item.foodId) {
      source.meals.push({
        kcal,
        recipeId: null,
        mealId: null,
        items: [{ foodId: item.foodId, servings: Number(item.servings) }],
      });
    } else if (item.recipeId || item.mealId) {
      source.meals.push({
        kcal,
        recipeId: item.recipeId,
        mealId: item.mealId,
        items: null,
      });
    }
  }
  // Rows are read by id only: each came from a plan the reader passed the
  // access rule for (a client never needs the coach's rows directly).
  if (recipeIds.length > 0) {
    const recipeRows = await db
      .select({ id: recipes.id, totalKcal: recipes.totalKcal })
      .from(recipes)
      .where(inArray(recipes.id, recipeIds));
    source.recipeTotals.push(
      ...recipeRows.map((r) => ({
        id: r.id,
        totalKcal: r.totalKcal === null ? null : Number(r.totalKcal),
      })),
    );
    const ingredientRows = await db
      .select()
      .from(recipeIngredients)
      .where(inArray(recipeIngredients.recipeId, recipeIds));
    source.recipeIngredients.push(
      ...ingredientRows.map((r) => ({
        recipeId: r.recipeId,
        foodId: r.foodId,
        customName: r.customName,
        quantity: Number(r.quantity),
        unit: r.unit,
      })),
    );
  }
  if (mealIds.length > 0) {
    const mealRows = await db
      .select({ id: meals.id, totalKcal: meals.totalKcal })
      .from(meals)
      .where(inArray(meals.id, mealIds));
    source.mealTotals.push(
      ...mealRows.map((m) => ({ id: m.id, totalKcal: Number(m.totalKcal) })),
    );
    const mealItemRows = await db
      .select()
      .from(mealItems)
      .where(inArray(mealItems.mealId, mealIds));
    source.mealItems.push(
      ...mealItemRows.map((m) => ({
        mealId: m.mealId,
        foodId: m.foodId,
        recipeId: m.recipeId,
        servings: Number(m.servings),
      })),
    );
  }

  // Mealprint plans, through Mealprint's own owner-scoped source builder.
  const mealPlanRefs = refs.filter((r) => r.mealPlanId);
  if (mealPlanRefs.length > 0) {
    const verdict = await assertEntitlement(userId, "meal_ai");
    if (verdict.allowed) {
      const mealPlanRepo = new MealPlanRepository();
      for (const ref of mealPlanRefs) {
        let planSource: ShoppingListSource | null = null;
        try {
          planSource = await mealPlanRepo.getShoppingSource(
            userId,
            ref.mealPlanId!,
          );
        } catch (error) {
          if (!(error instanceof PlanNutritionUnavailableError)) throw error;
        }
        if (!planSource) continue;
        source.meals.push(...planSource.meals);
        // Each plan's source carries the FULL ingredient rows of every recipe
        // (and items of every saved meal) it uses. `deriveShoppingList`
        // applies a recipe's rows once per USE, so the rows themselves must
        // appear once overall, however many plans share the recipe.
        const haveRecipes = new Set(
          source.recipeIngredients.map((r) => r.recipeId),
        );
        source.recipeIngredients.push(
          ...planSource.recipeIngredients.filter(
            (r) => !haveRecipes.has(r.recipeId),
          ),
        );
        const haveMeals = new Set(source.mealItems.map((m) => m.mealId));
        source.mealItems.push(
          ...planSource.mealItems.filter((m) => !haveMeals.has(m.mealId)),
        );
        source.foods.push(...planSource.foods);
        source.recipeTotals.push(...planSource.recipeTotals);
        source.mealTotals.push(...planSource.mealTotals);
        counted.push({
          nutritionPlanId: null,
          mealPlanId: ref.mealPlanId,
          addedAt: ref.addedAt.toISOString(),
        });
      }
    }
  }

  const foodIds = [
    ...new Set(
      [
        ...items.map((i) => i.foodId),
        ...source.recipeIngredients.map((r) => r.foodId),
        ...source.mealItems.map((m) => m.foodId),
      ].filter(Boolean),
    ),
  ].filter((id) => !source.foods.some((f) => f.id === id)) as string[];
  if (foodIds.length > 0) {
    const foodRows = await db
      .select()
      .from(foods)
      .where(inArray(foods.id, foodIds));
    source.foods.push(
      ...foodRows.map((f) => ({
        id: f.id,
        name: f.name,
        servingSize: Number(f.servingSize),
        servingUnit: f.servingUnit,
        servingQuantity:
          f.servingQuantity === null ? null : Number(f.servingQuantity),
        categoryTags: f.categoryTags,
      })),
    );
  }

  const derived = deriveShoppingList(source);
  return {
    aisles: derived.aisles,
    totalItems: derived.totalItems,
    plans: counted,
    asOf,
  };
}

export type AddShoppingPlanResult =
  | { ok: true }
  | { ok: false; error: "plan_not_found" };

/** Add a plan to the list; idempotent. A list plan must be readable, a Mealprint plan owned. */
export async function addShoppingPlan(
  userId: string,
  ref: { nutritionPlanId?: string; mealPlanId?: string },
): Promise<AddShoppingPlanResult> {
  const db = getDb();
  if (ref.nutritionPlanId) {
    const readable = await new NutritionPlanRepository().getReadable(
      userId,
      ref.nutritionPlanId,
    );
    if (!readable) return { ok: false, error: "plan_not_found" };
    await db
      .insert(shoppingListPlans)
      .values({ userId, nutritionPlanId: readable.plan.id })
      .onConflictDoNothing({
        target: [shoppingListPlans.userId, shoppingListPlans.nutritionPlanId],
      });
    return { ok: true };
  }
  const mealPlanId = ref.mealPlanId!;
  if (!isUuid(mealPlanId)) return { ok: false, error: "plan_not_found" };
  const owned = await new MealPlanRepository().get(userId, mealPlanId);
  if (!owned) return { ok: false, error: "plan_not_found" };
  await db
    .insert(shoppingListPlans)
    .values({ userId, mealPlanId })
    .onConflictDoNothing({
      target: [shoppingListPlans.userId, shoppingListPlans.mealPlanId],
    });
  return { ok: true };
}

/** Remove a plan (either kind) from the list; idempotent. */
export async function removeShoppingPlan(
  userId: string,
  planId: string,
): Promise<void> {
  if (!isUuid(planId)) return;
  await getDb()
    .delete(shoppingListPlans)
    .where(
      and(
        eq(shoppingListPlans.userId, userId),
        or(
          eq(shoppingListPlans.nutritionPlanId, planId),
          eq(shoppingListPlans.mealPlanId, planId),
        ),
      ),
    );
}
