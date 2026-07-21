import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { localIdFactory } from "@/application/commands/localId";
import { createRecipeCommand } from "@/application/commands/nutrition.command";
import type { CreateRecipeInput, Recipe } from "@/domain/models/nutrition";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Create a recipe (M9). Optimistic: computes provisional totals from the
 * ingredients' cached foods (the server materialises the authoritative totals
 * on flush; the next list refresh reconciles), inserts the local row, enqueues
 * `POST /recipes`, then drains. Returns the optimistic recipe (null when signed
 * out).
 */
export function useCreateRecipe(): {
  mutate: (input: CreateRecipeInput) => Promise<Recipe | null>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (input: CreateRecipeInput) => {
      if (!userId) return null;
      // Recipe-import macros fix: a client-supplied whole-recipe total (import
      // scrape or the whole-recipe AI estimate) is authoritative — prefer it
      // over the ingredient-derived sum so the optimistic local recipe
      // doesn't flash 0 macros while unlinked ingredient rows wait on the
      // server round-trip to materialise them.
      const totals =
        input.providedTotals ??
        input.ingredients.reduce(
          (acc, ing) => {
            const food = ing.foodId
              ? storage.getCachedFoodById(ing.foodId)
              : null;
            if (!food) return acc;
            return {
              kcal: acc.kcal + food.kcal * ing.quantity,
              proteinG: acc.proteinG + food.proteinG * ing.quantity,
              carbsG: acc.carbsG + food.carbsG * ing.quantity,
              fatG: acc.fatG + food.fatG * ing.quantity,
            };
          },
          { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        );
      const recipe = createRecipeCommand(
        { storage, userId, idFactory: localIdFactory },
        input,
        {
          kcal: Math.round(totals.kcal),
          proteinG: Math.round(totals.proteinG),
          carbsG: Math.round(totals.carbsG),
          fatG: Math.round(totals.fatG),
        },
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useCreateRecipe] queue flush failed:", err);
      }
      return recipe;
    },
    [auth, storage, userId],
  );

  return { mutate };
}
