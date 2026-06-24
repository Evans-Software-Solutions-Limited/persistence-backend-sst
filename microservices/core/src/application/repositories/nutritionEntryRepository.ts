import { and, eq, desc, sql } from "drizzle-orm";
import { nutritionEntries, type NutritionEntry } from "@persistence/db";
import { getDb } from "@persistence/db/client";

export type MealSlot = "breakfast" | "lunch" | "snack" | "dinner";

/**
 * Wire shape for a logged entry. Macros are NUMBERS here — Drizzle returns
 * `numeric` columns as strings, so the repository parses them at this boundary
 * (per BACKEND_BRIEF § numeric note) to keep the API wire shape numeric and
 * never do string-concat macro math downstream.
 */
export type NutritionEntryDTO = {
  id: string;
  userId: string;
  foodId: string | null;
  recipeId: string | null;
  mealId: string | null;
  mealSlot: MealSlot;
  servings: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  loggedAt: string;
  loggedByUserId: string | null;
  aiEstimated: boolean;
  aiConfidence: number | null;
};

export type CreateEntryInput = {
  foodId?: string | null;
  recipeId?: string | null;
  mealId?: string | null;
  mealSlot: MealSlot;
  servings: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  loggedAt: string;
};

export type UpdateEntryInput = Partial<
  Pick<
    CreateEntryInput,
    "mealSlot" | "servings" | "kcal" | "proteinG" | "carbsG" | "fatG"
  >
>;

function toDTO(row: NutritionEntry): NutritionEntryDTO {
  return {
    id: row.id,
    userId: row.userId,
    foodId: row.foodId,
    recipeId: row.recipeId,
    mealId: row.mealId,
    mealSlot: row.mealSlot as MealSlot,
    servings: Number(row.servings),
    kcal: Number(row.kcal),
    proteinG: Number(row.proteinG),
    carbsG: Number(row.carbsG),
    fatG: Number(row.fatG),
    loggedAt:
      row.loggedAt instanceof Date
        ? row.loggedAt.toISOString()
        : String(row.loggedAt),
    loggedByUserId: row.loggedByUserId,
    aiEstimated: row.aiEstimated,
    aiConfidence: row.aiConfidence === null ? null : Number(row.aiConfidence),
  };
}

export class NutritionEntryRepository {
  static readonly key = "NutritionEntryRepository";

  /** A day's entries for a user, newest first. `date` is YYYY-MM-DD (user-local). */
  async listByDate(userId: string, date: string): Promise<NutritionEntryDTO[]> {
    const db = getDb();

    const rows = await db
      .select()
      .from(nutritionEntries)
      .where(
        and(
          eq(nutritionEntries.userId, userId),
          // `logged_at` is timestamptz (UTC); a bare `::date` would bucket in
          // the Postgres session tz (UTC on Neon), dropping near-midnight
          // entries into the wrong day for any non-UTC user. Convert to the
          // user's local day first (profiles.timezone, default Europe/London —
          // same default as the streak engine). Review fix (PR #124).
          sql`(${nutritionEntries.loggedAt} AT TIME ZONE COALESCE((SELECT timezone FROM profiles WHERE id = ${userId}), 'Europe/London'))::date = ${date}::date`,
        ),
      )
      .orderBy(desc(nutritionEntries.loggedAt));

    return rows.map(toDTO);
  }

  /** A single owned entry (ownership in WHERE) — used by the edit re-derivation. */
  async getById(id: string, userId: string): Promise<NutritionEntryDTO | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(nutritionEntries)
      .where(
        and(eq(nutritionEntries.id, id), eq(nutritionEntries.userId, userId)),
      )
      .limit(1);
    return rows[0] ? toDTO(rows[0]) : null;
  }

  async create(
    userId: string,
    input: CreateEntryInput,
  ): Promise<NutritionEntryDTO> {
    const db = getDb();

    const result = await db
      .insert(nutritionEntries)
      .values({
        userId,
        foodId: input.foodId ?? null,
        recipeId: input.recipeId ?? null,
        mealId: input.mealId ?? null,
        mealSlot: input.mealSlot,
        servings: String(input.servings),
        kcal: String(input.kcal),
        proteinG: String(input.proteinG),
        carbsG: String(input.carbsG),
        fatG: String(input.fatG),
        loggedAt: new Date(input.loggedAt),
      })
      .returning();

    return toDTO(result[0]);
  }

  /** Ownership folded into the WHERE — null when not found or not owned (→ 404). */
  async update(
    id: string,
    userId: string,
    input: UpdateEntryInput,
  ): Promise<NutritionEntryDTO | null> {
    const db = getDb();

    const patch: Record<string, unknown> = {};
    if (input.mealSlot !== undefined) patch.mealSlot = input.mealSlot;
    if (input.servings !== undefined) patch.servings = String(input.servings);
    if (input.kcal !== undefined) patch.kcal = String(input.kcal);
    if (input.proteinG !== undefined) patch.proteinG = String(input.proteinG);
    if (input.carbsG !== undefined) patch.carbsG = String(input.carbsG);
    if (input.fatG !== undefined) patch.fatG = String(input.fatG);

    const result = await db
      .update(nutritionEntries)
      .set(patch)
      .where(
        and(eq(nutritionEntries.id, id), eq(nutritionEntries.userId, userId)),
      )
      .returning();

    return result[0] ? toDTO(result[0]) : null;
  }

  /** Ownership folded into the WHERE — false when not found or not owned. */
  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDb();

    const result = await db
      .delete(nutritionEntries)
      .where(
        and(eq(nutritionEntries.id, id), eq(nutritionEntries.userId, userId)),
      )
      .returning();

    return !!result[0];
  }
}
