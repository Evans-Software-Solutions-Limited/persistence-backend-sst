import { and, eq, desc, sql } from "drizzle-orm";
import {
  nutritionEntries,
  userMeals,
  type NutritionEntry,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { stripNul } from "../shared/stripNul";

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
  customName: string | null;
  /**
   * Design D "Your meals". Stored for entries logged with one; on reads,
   * entries without one (older bundles) are given the user's default meal for
   * their `mealSlot` — see `withEffectiveUserMealIds`. Older apps ignore it.
   */
  userMealId: string | null;
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
  customName?: string | null;
  aiEstimated?: boolean;
  aiConfidence?: number | null;
  userMealId?: string | null;
  /** Provenance for plan meals added to the log (PER-118). No FK. */
  sourcePlanId?: string | null;
  sourcePlanMealId?: string | null;
  /**
   * `Idempotency-Key` (single POST) or the batch entry's `clientRequestId`.
   * A second create with the same key for the same user returns the first row.
   */
  clientRequestId?: string | null;
};

export type UpdateEntryInput = Partial<
  Pick<
    CreateEntryInput,
    | "mealSlot"
    | "servings"
    | "kcal"
    | "proteinG"
    | "carbsG"
    | "fatG"
    | "customName"
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
    customName: row.customName,
    userMealId: row.userMealId ?? null,
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

  /**
   * Total kcal logged for a user-local day — feeds the Home "Fuel" ring without
   * pulling the full entry list. Single SUM aggregate (no GROUP BY → no 42803
   * trap; the tz-aware day predicate lives only in the WHERE). Returns a number
   * (numeric→number boundary); 0 when nothing's logged.
   */
  async sumKcalForDay(userId: string, date: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({
        kcal: sql<string>`COALESCE(SUM(${nutritionEntries.kcal}), 0)`,
      })
      .from(nutritionEntries)
      .where(
        and(
          eq(nutritionEntries.userId, userId),
          // Same user-local day bucketing as listByDate (PR #124).
          sql`(${nutritionEntries.loggedAt} AT TIME ZONE COALESCE((SELECT timezone FROM profiles WHERE id = ${userId}), 'Europe/London'))::date = ${date}::date`,
        ),
      );
    return Number(rows[0]?.kcal ?? 0);
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

  /**
   * The caller's entry created under this idempotency key, or null. Checked
   * before macro derivation so a replay returns the committed row even if the
   * food it referenced has since been deleted.
   */
  async getByClientRequestId(
    userId: string,
    clientRequestId: string,
  ): Promise<NutritionEntryDTO | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(nutritionEntries)
      .where(
        and(
          eq(nutritionEntries.userId, userId),
          eq(nutritionEntries.clientRequestId, clientRequestId),
        ),
      )
      .limit(1);
    return rows[0] ? toDTO(rows[0]) : null;
  }

  /**
   * Insert an entry. With `clientRequestId` the insert is replay-safe: the
   * FULL unique index `(user_id, client_request_id)` turns a second attempt
   * into a no-op and the first attempt's row is returned, so a retry after a
   * lost response is indistinguishable from the original success. Keys are
   * scoped per user, so two users' identical keys never collide.
   */
  async create(
    userId: string,
    input: CreateEntryInput,
  ): Promise<NutritionEntryDTO> {
    const db = getDb();
    const key = input.clientRequestId ?? null;

    const values = {
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
      customName: input.customName ?? null,
      aiEstimated: input.aiEstimated ?? false,
      aiConfidence:
        input.aiConfidence === undefined || input.aiConfidence === null
          ? null
          : String(input.aiConfidence),
      userMealId: input.userMealId ?? null,
      sourcePlanId: input.sourcePlanId ?? null,
      sourcePlanMealId: input.sourcePlanMealId ?? null,
      clientRequestId: key,
    };

    if (key === null) {
      const result = await db
        .insert(nutritionEntries)
        .values(values)
        .returning();
      return toDTO(result[0]);
    }

    const inserted = await db
      .insert(nutritionEntries)
      .values(values)
      .onConflictDoNothing({
        target: [nutritionEntries.userId, nutritionEntries.clientRequestId],
      })
      .returning();
    if (inserted[0]) return toDTO(inserted[0]);

    // Replay: the first attempt committed this key. Return its row.
    const existing = await this.getByClientRequestId(userId, key);
    if (!existing) {
      // Only reachable if the row was deleted between the conflict and this
      // read — surface it rather than inventing a row.
      throw new Error("nutrition entry idempotency conflict without a row");
    }
    return existing;
  }

  /** Ownership folded into the WHERE — null when not found or not owned (→ 404). */
  async update(
    id: string,
    userId: string,
    input: UpdateEntryInput,
  ): Promise<NutritionEntryDTO | null> {
    const db = getDb();

    const patch: Record<string, unknown> = {};
    if (input.mealSlot !== undefined) {
      patch.mealSlot = input.mealSlot;
      // Moving an entry to another slot (the only move older bundles can
      // make) keeps its Your-meals meal only if that meal maps to the new
      // slot. Otherwise it is cleared, so the entry groups under the default
      // meal for its new slot instead of staying in a meal of the old one.
      patch.userMealId = sql`CASE WHEN (SELECT ${userMeals.logSlot} FROM ${userMeals} WHERE ${userMeals.id} = ${nutritionEntries.userMealId} AND ${userMeals.userId} = ${userId}) = ${input.mealSlot} THEN ${nutritionEntries.userMealId} ELSE NULL END`;
    }
    if (input.servings !== undefined) patch.servings = String(input.servings);
    if (input.kcal !== undefined) patch.kcal = String(input.kcal);
    if (input.proteinG !== undefined) patch.proteinG = String(input.proteinG);
    if (input.carbsG !== undefined) patch.carbsG = String(input.carbsG);
    if (input.fatG !== undefined) patch.fatG = String(input.fatG);
    // NUL stripped: Postgres `text` rejects it (22021), which 500'd the edit.
    if (input.customName !== undefined)
      patch.customName =
        input.customName === null ? null : stripNul(input.customName);

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
