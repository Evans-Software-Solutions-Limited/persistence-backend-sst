import { and, eq, desc } from "drizzle-orm";
import { meals, mealItems, type Meal, type MealItem } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { MacroTotals } from "../recipes/services/materialiseMacros";
import type { MealItemInput } from "../meals/services/materialiseMealMacros";

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
      .where(eq(meals.userId, userId))
      .orderBy(desc(meals.createdAt));
    return rows.map((r) => toMealDTO(r, []));
  }

  async getById(id: string, userId: string): Promise<MealDTO | null> {
    const db = getDb();
    const found = await db
      .select()
      .from(meals)
      .where(and(eq(meals.id, id), eq(meals.userId, userId)))
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
    const mealId = await db.transaction(async (tx) => {
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

      if (input.items.length > 0) {
        await tx.insert(mealItems).values(
          input.items.map((it) => ({
            mealId: meal.id,
            foodId: it.foodId ?? null,
            recipeId: it.recipeId ?? null,
            servings: String(it.servings),
            sortOrder: it.sortOrder,
          })),
        );
      }
      return meal.id;
    });

    const created = await this.getById(mealId, userId);
    if (!created) throw new Error("meal_create_failed");
    return created;
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
      .where(and(eq(meals.id, id), eq(meals.userId, userId)))
      .returning();

    return updated ? this.getById(id, userId) : null;
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
