import { create } from "zustand";
import type { RecipeNutrition } from "@/domain/models/nutrition";

/**
 * useRecipeDraft — the seam between the Import-from-URL / Snap-a-recipe-photo
 * flows and the manual create-recipe form (Recipes AI PR3). Both AI/import
 * flows call `setSeed(...)` with their extracted result, then
 * `router.replace` to `fuel/recipe-create`, which reads `seed` ONCE on mount
 * to pre-fill its fields, then `clear()`s it — so a later direct visit to
 * "Create a recipe" (no seed) starts blank, and a stale seed never leaks into
 * an unrelated create session.
 *
 * Spec: specs/milestones (Recipes AI PR3 brief) § B. Recipe draft store
 */

export type RecipeDraftIngredientSeed = {
  name: string;
  quantity: number | null;
  unit: string | null;
};

export type RecipeDraftSeed = {
  title: string;
  servings: number | null;
  instructions: string | null;
  ingredients: RecipeDraftIngredientSeed[];
  source: "manual" | "import" | "snap";
  /**
   * Recipe-import macros fix — PER-SERVING macros scraped from the imported
   * page (`ImportedRecipe.nutrition`), carried through so the create form can
   * seed `providedTotals` (whole-recipe = per-serving × servings). Undefined/
   * null for non-import seeds (manual/snap) and for an import with no scraped
   * nutrition.
   */
  nutrition?: RecipeNutrition | null;
  /** The import source URL, carried through so the create form can pass it to
   * `CreateRecipeInput.sourceUrl`. Undefined/null for non-import seeds. */
  sourceUrl?: string | null;
};

export interface RecipeDraftState {
  seed: RecipeDraftSeed | null;
  setSeed: (seed: RecipeDraftSeed) => void;
  clear: () => void;
}

export const useRecipeDraft = create<RecipeDraftState>((set) => ({
  seed: null,
  setSeed: (seed) => set({ seed }),
  clear: () => set({ seed: null }),
}));
