import { and, eq, ne, ilike, or, desc, inArray, sql } from "drizzle-orm";
import { foods, type Food } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { OffFoodRow } from "../nutrition/services/offMapper";

/**
 * Wire shape for a food. Macros parsed to numbers at this boundary (Drizzle
 * returns `numeric` as strings) — see BACKEND_BRIEF § numeric note.
 */
export type FoodDTO = {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: number;
  servingUnit: string;
  source: string;
  createdBy: string | null;
};

export type CreateFoodInput = {
  name: string;
  brand?: string | null;
  barcode?: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: number;
  servingUnit: string;
  source?: string;
};

export function toFoodDTO(row: Food): FoodDTO {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    kcal: Number(row.kcal),
    proteinG: Number(row.proteinG),
    carbsG: Number(row.carbsG),
    fatG: Number(row.fatG),
    servingSize: Number(row.servingSize),
    servingUnit: row.servingUnit,
    source: row.source,
    createdBy: row.createdBy,
  };
}

export class FoodRepository {
  static readonly key = "FoodRepository";

  async getById(id: string): Promise<FoodDTO | null> {
    const db = getDb();
    const result = await db
      .select()
      .from(foods)
      .where(eq(foods.id, id))
      .limit(1);
    return result[0] ? toFoodDTO(result[0]) : null;
  }

  /**
   * Batch fetch by id, scoped like `search()`: shareable (OFF/curated) rows OR
   * the caller's own custom foods. Without the scope another user's private
   * `source='user'` food would leak into a recipe/meal's materialised totals
   * if its id were supplied in the request body. Review fix (PR #124).
   */
  async getByIds(ids: string[], userId: string): Promise<FoodDTO[]> {
    if (ids.length === 0) return [];
    const db = getDb();
    const rows = await db
      .select()
      .from(foods)
      .where(
        and(
          inArray(foods.id, ids),
          or(eq(foods.createdBy, userId), ne(foods.source, "user")),
        ),
      );
    return rows.map(toFoodDTO);
  }

  /**
   * Resolve a barcode to a food the caller may see: a shareable (OFF/curated)
   * row OR the caller's OWN custom food with that barcode. Another user's
   * private `source='user'` row never surfaces (leak fix), while the owner's
   * own barcoded custom food still resolves on re-scan. When both exist, the
   * caller's own row wins. Review fix (PR #124). Live OFF fallback covers a miss.
   */
  async getByBarcode(barcode: string, userId: string): Promise<FoodDTO | null> {
    const db = getDb();
    const result = await db
      .select()
      .from(foods)
      .where(
        and(
          eq(foods.barcode, barcode),
          or(eq(foods.createdBy, userId), ne(foods.source, "user")),
        ),
      )
      // Prefer the caller's own custom row over the shared catalogue entry.
      .orderBy(sql`(${foods.createdBy} = ${userId}) DESC`)
      .limit(1);
    return result[0] ? toFoodDTO(result[0]) : null;
  }

  /**
   * Search by name across the global library + the user's own custom foods.
   * Excludes other users' private custom rows (only `source <> 'user'` OR the
   * caller's own `created_by`).
   */
  async search(query: string, userId: string, limit = 50): Promise<FoodDTO[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(foods)
      .where(
        and(
          ilike(foods.name, `%${query}%`),
          or(eq(foods.createdBy, userId), eq(foods.source, "openfoodfacts")),
        ),
      )
      .orderBy(desc(foods.createdAt))
      .limit(limit);
    return rows.map(toFoodDTO);
  }

  async create(userId: string, input: CreateFoodInput): Promise<FoodDTO> {
    const db = getDb();
    const result = await db
      .insert(foods)
      .values({
        name: input.name,
        brand: input.brand ?? null,
        barcode: input.barcode ?? null,
        kcal: String(input.kcal),
        proteinG: String(input.proteinG),
        carbsG: String(input.carbsG),
        fatG: String(input.fatG),
        servingSize: String(input.servingSize),
        servingUnit: input.servingUnit,
        source: input.source ?? "user",
        createdBy: userId,
      })
      .returning();
    return toFoodDTO(result[0]);
  }

  /**
   * Idempotent bulk upsert of Open Food Facts rows (seed + delta refresh, M9).
   * Conflict on `barcode` refreshes the cached macros so the seed/delta can be
   * re-run safely. Returns the number of rows written. OFF rows stay tagged
   * `source='openfoodfacts'` + `created_by=null` (segregable for ODbL).
   */
  async upsertManyFromOff(rows: OffFoodRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const db = getDb();
    await db
      .insert(foods)
      .values(
        rows.map((r) => ({
          name: r.name,
          brand: r.brand,
          barcode: r.barcode,
          kcal: String(r.kcal),
          proteinG: String(r.proteinG),
          carbsG: String(r.carbsG),
          fatG: String(r.fatG),
          servingSize: String(r.servingSize),
          servingUnit: r.servingUnit,
          source: r.source,
          createdBy: null,
        })),
      )
      // Conflict-target the PARTIAL unique index (barcode WHERE source<>'user'),
      // so this only ever dedups/updates OFF-catalogue rows and can NEVER
      // overwrite a private user food that happens to share a barcode (the High
      // finding — a user's homemade row was being silently rewritten by the OFF
      // delta cron / a concurrent resolve). PR #124 review.
      .onConflictDoUpdate({
        target: foods.barcode,
        targetWhere: sql`source <> 'user' AND barcode IS NOT NULL`,
        set: {
          name: sql`excluded.name`,
          brand: sql`excluded.brand`,
          kcal: sql`excluded.kcal`,
          proteinG: sql`excluded.protein_g`,
          carbsG: sql`excluded.carbs_g`,
          fatG: sql`excluded.fat_g`,
          servingSize: sql`excluded.serving_size`,
          servingUnit: sql`excluded.serving_unit`,
        },
      });
    return rows.length;
  }
}
