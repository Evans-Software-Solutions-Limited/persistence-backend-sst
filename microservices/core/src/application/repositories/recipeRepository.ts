import { and, eq, desc, inArray } from "drizzle-orm";
import {
  recipes,
  recipeIngredients,
  type Recipe,
  type RecipeIngredient,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type {
  IngredientInput,
  MacroTotals,
} from "../recipes/services/materialiseMacros";

export type RecipeIngredientDTO = {
  id: string;
  foodId: string | null;
  customName: string | null;
  quantity: number;
  unit: string;
  sortOrder: number;
};

export type RecipeDTO = {
  id: string;
  userId: string;
  name: string;
  photoUrl: string | null;
  servings: number;
  instructions: string | null;
  source: string;
  sourceUrl: string | null;
  totalKcal: number | null;
  totalProteinG: number | null;
  totalCarbsG: number | null;
  totalFatG: number | null;
  ingredients: RecipeIngredientDTO[];
};

export type CreateRecipeInput = {
  name: string;
  photoUrl?: string | null;
  servings: number;
  instructions?: string | null;
  source?: string;
  sourceUrl?: string | null;
  ingredients: IngredientInput[];
};

export type UpdateRecipeInput = Partial<
  Pick<CreateRecipeInput, "name" | "photoUrl" | "servings" | "instructions">
>;

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

function toIngredientDTO(row: RecipeIngredient): RecipeIngredientDTO {
  return {
    id: row.id,
    foodId: row.foodId,
    customName: row.customName,
    quantity: Number(row.quantity),
    unit: row.unit,
    sortOrder: row.sortOrder,
  };
}

function toRecipeDTO(row: Recipe, ingredients: RecipeIngredient[]): RecipeDTO {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    photoUrl: row.photoUrl,
    servings: Number(row.servings),
    instructions: row.instructions,
    source: row.source,
    sourceUrl: row.sourceUrl,
    totalKcal: numOrNull(row.totalKcal),
    totalProteinG: numOrNull(row.totalProteinG),
    totalCarbsG: numOrNull(row.totalCarbsG),
    totalFatG: numOrNull(row.totalFatG),
    ingredients: ingredients
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toIngredientDTO),
  };
}

export class RecipeRepository {
  static readonly key = "RecipeRepository";

  async list(userId: string): Promise<RecipeDTO[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(recipes)
      .where(eq(recipes.userId, userId))
      .orderBy(desc(recipes.createdAt));
    // List view omits ingredients for payload size; cards show name + totals.
    return rows.map((r) => toRecipeDTO(r, []));
  }

  async getById(id: string, userId: string): Promise<RecipeDTO | null> {
    const db = getDb();
    const found = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.userId, userId)))
      .limit(1);
    if (!found[0]) return null;
    const ings = await db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, id));
    return toRecipeDTO(found[0], ings);
  }

  /**
   * Batch macro summaries for the caller's recipes — used to materialise meal
   * totals (STORY-007). Scoped to `userId`; unknown / unowned ids are absent
   * from the returned map.
   */
  async getMacroSummaries(
    ids: string[],
    userId: string,
  ): Promise<
    Map<
      string,
      {
        totalKcal: number;
        totalProteinG: number;
        totalCarbsG: number;
        totalFatG: number;
        servings: number;
      }
    >
  > {
    const map = new Map<
      string,
      {
        totalKcal: number;
        totalProteinG: number;
        totalCarbsG: number;
        totalFatG: number;
        servings: number;
      }
    >();
    if (ids.length === 0) return map;
    const db = getDb();
    const rows = await db
      .select()
      .from(recipes)
      .where(and(inArray(recipes.id, ids), eq(recipes.userId, userId)));
    for (const r of rows) {
      map.set(r.id, {
        totalKcal: Number(r.totalKcal ?? 0),
        totalProteinG: Number(r.totalProteinG ?? 0),
        totalCarbsG: Number(r.totalCarbsG ?? 0),
        totalFatG: Number(r.totalFatG ?? 0),
        servings: Number(r.servings),
      });
    }
    return map;
  }

  async create(
    userId: string,
    input: CreateRecipeInput,
    totals: MacroTotals,
  ): Promise<RecipeDTO> {
    const db = getDb();
    const recipeId = await db.transaction(async (tx) => {
      const [recipe] = await tx
        .insert(recipes)
        .values({
          userId,
          name: input.name,
          photoUrl: input.photoUrl ?? null,
          servings: String(input.servings),
          instructions: input.instructions ?? null,
          source: input.source ?? "manual",
          sourceUrl: input.sourceUrl ?? null,
          totalKcal: String(totals.kcal),
          totalProteinG: String(totals.proteinG),
          totalCarbsG: String(totals.carbsG),
          totalFatG: String(totals.fatG),
        })
        .returning();

      if (input.ingredients.length > 0) {
        await tx.insert(recipeIngredients).values(
          input.ingredients.map((ing) => ({
            recipeId: recipe.id,
            foodId: ing.foodId ?? null,
            customName: ing.customName ?? null,
            quantity: String(ing.quantity),
            unit: ing.unit,
            sortOrder: ing.sortOrder,
          })),
        );
      }
      return recipe.id;
    });

    const created = await this.getById(recipeId, userId);
    if (!created) throw new Error("recipe_create_failed");
    return created;
  }

  /** Metadata-only update (name/photo/servings/instructions); ownership in WHERE. */
  async update(
    id: string,
    userId: string,
    input: UpdateRecipeInput,
  ): Promise<RecipeDTO | null> {
    const db = getDb();
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.photoUrl !== undefined) patch.photoUrl = input.photoUrl;
    if (input.servings !== undefined) patch.servings = String(input.servings);
    if (input.instructions !== undefined)
      patch.instructions = input.instructions;

    const [updated] = await db
      .update(recipes)
      .set(patch)
      .where(and(eq(recipes.id, id), eq(recipes.userId, userId)))
      .returning();

    return updated ? this.getById(id, userId) : null;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDb();
    const result = await db
      .delete(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.userId, userId)))
      .returning();
    return !!result[0];
  }
}
