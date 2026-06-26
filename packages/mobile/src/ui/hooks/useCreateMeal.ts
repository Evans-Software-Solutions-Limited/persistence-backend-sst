import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { localIdFactory } from "@/application/commands/localId";
import { createMealCommand } from "@/application/commands/nutrition.command";
import type { CreateMealInput, Meal } from "@/domain/models/nutrition";
import {
  scaleFoodMacros,
  scaleRecipeMacros,
} from "@/domain/services/nutrition.service";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Save a meal preset from logged foods/recipes (M9). Optimistic: computes
 * provisional totals from the items' cached foods (per-serving × servings) and
 * recipes (total / servings × servings); the server materialises the
 * authoritative totals on flush. Inserts the local row, enqueues `POST /meals`,
 * then drains. Returns the optimistic meal (null when signed out).
 */
export function useCreateMeal(): {
  mutate: (input: CreateMealInput) => Promise<Meal | null>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (input: CreateMealInput) => {
      if (!userId) return null;
      const totals = input.items.reduce(
        (acc, it) => {
          let m = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
          if (it.foodId) {
            const food = storage.getCachedFoodById(it.foodId);
            if (food) m = scaleFoodMacros(food, it.servings);
          } else if (it.recipeId) {
            const recipe = storage.getCachedRecipe(userId, it.recipeId);
            if (recipe) m = scaleRecipeMacros(recipe, it.servings);
          }
          return {
            kcal: acc.kcal + m.kcal,
            proteinG: acc.proteinG + m.proteinG,
            carbsG: acc.carbsG + m.carbsG,
            fatG: acc.fatG + m.fatG,
          };
        },
        { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      );
      const meal = createMealCommand(
        { storage, userId, idFactory: localIdFactory },
        input,
        totals,
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useCreateMeal] queue flush failed:", err);
      }
      return meal;
    },
    [auth, storage, userId],
  );

  return { mutate };
}
