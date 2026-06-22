import { and, eq, ilike, or, desc, inArray } from "drizzle-orm";
import { foods, type Food } from "@persistence/db";
import { getDb } from "@persistence/db/client";

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

  /** Batch fetch by id — used to materialise recipe/meal macros. */
  async getByIds(ids: string[]): Promise<FoodDTO[]> {
    if (ids.length === 0) return [];
    const db = getDb();
    const rows = await db.select().from(foods).where(inArray(foods.id, ids));
    return rows.map(toFoodDTO);
  }

  async getByBarcode(barcode: string): Promise<FoodDTO | null> {
    const db = getDb();
    const result = await db
      .select()
      .from(foods)
      .where(eq(foods.barcode, barcode))
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
}
