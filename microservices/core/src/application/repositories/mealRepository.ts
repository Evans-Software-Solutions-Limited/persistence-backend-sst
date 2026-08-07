import { and, eq, desc, inArray } from "drizzle-orm";
import {
  foods,
  meals,
  mealItems,
  recipeIngredients,
  recipes,
  type Meal,
  type MealItem,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { MacroTotals } from "../recipes/services/materialiseMacros";
import type { MealItemInput } from "../meals/services/materialiseMealMacros";
import {
  mealNutritionDataIsUsable,
  NutritionSourceUnavailableError,
  recipeNutritionDataIsUsable,
} from "./nutritionDataValidity";
import { usableFoodForUserCondition } from "./foodRepository";

export type MealItemDTO = {
  id: string;
  foodId: string | null;
  recipeId: string | null;
  servings: number;
  sortOrder: number;
};

export type MealDTO = {
  id: string;
  userId: string;
  name: string;
  photoUrl: string | null;
  totalKcal: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  items: MealItemDTO[];
};

export type CreateMealInput = {
  name: string;
  photoUrl?: string | null;
  items: MealItemInput[];
};

export type UpdateMealInput = Partial<
  Pick<CreateMealInput, "name" | "photoUrl">
>;

function toItemDTO(row: MealItem): MealItemDTO {
  return {
    id: row.id,
    foodId: row.foodId,
    recipeId: row.recipeId,
    servings: Number(row.servings),
    sortOrder: row.sortOrder,
  };
}

function toMealDTO(row: Meal, items: MealItem[]): MealDTO {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    photoUrl: row.photoUrl,
    totalKcal: Number(row.totalKcal),
    totalProteinG: Number(row.totalProteinG),
    totalCarbsG: Number(row.totalCarbsG),
    totalFatG: Number(row.totalFatG),
    items: items
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toItemDTO),
  };
}

export class MealRepository {
  static readonly key = "MealRepository";

  async list(userId: string): Promise<MealDTO[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(meals)
      .where(and(eq(meals.userId, userId), mealNutritionDataIsUsable(meals.id)))
      .orderBy(desc(meals.createdAt));
    return rows.map((r) => toMealDTO(r, []));
  }

  async getById(id: string, userId: string): Promise<MealDTO | null> {
    const db = getDb();
    const found = await db
      .select()
      .from(meals)
      .where(
        and(
          eq(meals.id, id),
          eq(meals.userId, userId),
          mealNutritionDataIsUsable(meals.id),
        ),
      )
      .limit(1);
    if (!found[0]) return null;
    const items = await db
      .select()
      .from(mealItems)
      .where(eq(mealItems.mealId, id));
    return toMealDTO(found[0], items);
  }

  async create(
    userId: string,
    input: CreateMealInput,
    totals: MacroTotals,
  ): Promise<MealDTO> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const foodIds = [
        ...new Set(
          input.items
            .map((item) => item.foodId)
            .filter((id): id is string => id != null),
        ),
      ];
      const recipeIds = [
        ...new Set(
          input.items
            .map((item) => item.recipeId)
            .filter((id): id is string => id != null),
        ),
      ];
      // Keep transaction queries sequential. They share one pinned connection;
      // concurrent promises add no real parallelism and can make lock ordering
      // driver-dependent.
      const usableFoods =
        foodIds.length === 0
          ? []
          : await tx
              .select({ id: foods.id })
              .from(foods)
              .where(
                and(
                  inArray(foods.id, foodIds),
                  usableFoodForUserCondition(userId),
                ),
              )
              .for("share");
      const usableRecipes =
        recipeIds.length === 0
          ? []
          : await tx
              .select({ id: recipes.id })
              .from(recipes)
              .where(
                and(
                  inArray(recipes.id, recipeIds),
                  eq(recipes.userId, userId),
                  recipeNutritionDataIsUsable(recipes.id),
                ),
              )
              .for("share");
      const nestedOffFoods =
        recipeIds.length === 0
          ? []
          : await tx
              .select({
                id: foods.id,
                recipeId: recipeIngredients.recipeId,
                nutritionDataValid: foods.nutritionDataValid,
              })
              .from(recipeIngredients)
              .innerJoin(foods, eq(foods.id, recipeIngredients.foodId))
              .where(
                and(
                  inArray(recipeIngredients.recipeId, recipeIds),
                  eq(foods.source, "openfoodfacts"),
                ),
              )
              .for("share");
      const foundFoods = new Set(usableFoods.map((row) => row.id));
      const foundRecipes = new Set(usableRecipes.map((row) => row.id));
      const missing = [
        ...foodIds
          .filter((id) => !foundFoods.has(id))
          .map((id) => `food:${id}`),
        ...recipeIds
          .filter((id) => !foundRecipes.has(id))
          .map((id) => `recipe:${id}`),
      ];
      missing.push(
        ...nestedOffFoods
          .filter((food) => !food.nutritionDataValid)
          .map((food) => `recipe:${food.recipeId}`),
      );
      if (missing.length > 0) {
        throw new NutritionSourceUnavailableError([...new Set(missing)]);
      }

      const [meal] = await tx
        .insert(meals)
        .values({
          userId,
          name: input.name,
          photoUrl: input.photoUrl ?? null,
          totalKcal: String(totals.kcal),
          totalProteinG: String(totals.proteinG),
          totalCarbsG: String(totals.carbsG),
          totalFatG: String(totals.fatG),
        })
        .returning();

      const itemRows =
        input.items.length > 0
          ? await tx
              .insert(mealItems)
              .values(
                input.items.map((it) => ({
                  mealId: meal.id,
                  foodId: it.foodId ?? null,
                  recipeId: it.recipeId ?? null,
                  servings: String(it.servings),
                  sortOrder: it.sortOrder,
                })),
              )
              .returning()
          : [];
      return toMealDTO(meal, itemRows);
    });
  }

  async update(
    id: string,
    userId: string,
    input: UpdateMealInput,
  ): Promise<MealDTO | null> {
    const db = getDb();
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.photoUrl !== undefined) patch.photoUrl = input.photoUrl;

    const [updated] = await db
      .update(meals)
      .set(patch)
      .where(
        and(
          eq(meals.id, id),
          eq(meals.userId, userId),
          mealNutritionDataIsUsable(meals.id),
        ),
      )
      .returning();

    if (!updated) return null;
    const items = await db
      .select()
      .from(mealItems)
      .where(eq(mealItems.mealId, id));
    return toMealDTO(updated, items);
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDb();
    const result = await db
      .delete(meals)
      .where(and(eq(meals.id, id), eq(meals.userId, userId)))
      .returning();
    return !!result[0];
  }
}
