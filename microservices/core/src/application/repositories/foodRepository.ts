import { eq } from "drizzle-orm";
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
}
