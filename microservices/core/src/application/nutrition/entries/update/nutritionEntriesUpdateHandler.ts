import Elysia, { t } from "elysia";
import { NutritionEntryService } from "../../../repositories/nutritionEntryService";
import { FoodService } from "../../../repositories/foodService";
import { RecipeService } from "../../../repositories/recipeService";
import { MealService } from "../../../repositories/mealService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * PUT /nutrition/entries/:id — edit servings/slot/macros of an owned entry.
 * Ownership is folded into the mutation WHERE; a non-match returns 404 (don't
 * leak existence).
 *
 * Macro authority matches the create path: when the entry references a `foodId`
 * the server RE-DERIVES kcal/macros from `food × servings` and IGNORES any
 * client-supplied macros — otherwise a client could POST `{foodId, servings:1}`
 * (true kcal) then PUT `{kcal:1}` to drop the day's total below the streak band
 * (PR #124 review). One-off / recipe / meal entries keep the client values
 * (same posture as create). Referenced rows that have become unavailable —
 * including a recipe/meal backed by quarantined OFF nutrition — fail closed;
 * their historical diary entry remains readable but cannot be rewritten from
 * client-supplied macros.
 */
export const nutritionEntriesUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionEntryService)
  .use(FoodService)
  .use(RecipeService)
  .use(MealService)
  .put(
    "/nutrition/entries/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      const existing = await ctx.NutritionEntryRepository.getById(
        ctx.params.id,
        userId,
      );
      if (!existing) {
        ctx.set.status = 404;
        return { error: "entry_not_found" };
      }

      const patch = { ...ctx.body };
      // Server-authoritative re-derivation for food-backed entries.
      if (existing.foodId) {
        const food = await ctx.FoodRepository.getById(existing.foodId, userId);
        if (!food) {
          ctx.set.status = 409;
          return { error: "entry_nutrition_unavailable" };
        }
        const servings = ctx.body.servings ?? existing.servings;
        patch.servings = servings;
        patch.kcal = food.kcal * servings;
        patch.proteinG = food.proteinG * servings;
        patch.carbsG = food.carbsG * servings;
        patch.fatG = food.fatG * servings;
      } else if (existing.recipeId) {
        const recipe = await ctx.RecipeRepository.getById(
          existing.recipeId,
          userId,
        );
        if (!recipe) {
          ctx.set.status = 409;
          return { error: "entry_nutrition_unavailable" };
        }
        const servings = ctx.body.servings ?? existing.servings;
        const recipeServings = recipe.servings > 0 ? recipe.servings : 1;
        const factor = servings / recipeServings;
        patch.servings = servings;
        patch.kcal = (recipe.totalKcal ?? 0) * factor;
        patch.proteinG = (recipe.totalProteinG ?? 0) * factor;
        patch.carbsG = (recipe.totalCarbsG ?? 0) * factor;
        patch.fatG = (recipe.totalFatG ?? 0) * factor;
      } else if (existing.mealId) {
        const meal = await ctx.MealRepository.getById(existing.mealId, userId);
        if (!meal) {
          ctx.set.status = 409;
          return { error: "entry_nutrition_unavailable" };
        }
        const servings = ctx.body.servings ?? existing.servings;
        patch.servings = servings;
        patch.kcal = meal.totalKcal * servings;
        patch.proteinG = meal.totalProteinG * servings;
        patch.carbsG = meal.totalCarbsG * servings;
        patch.fatG = meal.totalFatG * servings;
      }

      const updated = await ctx.NutritionEntryRepository.update(
        ctx.params.id,
        userId,
        patch,
      );

      if (!updated) {
        ctx.set.status = 404;
        return { error: "entry_not_found" };
      }

      return { data: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        mealSlot: t.Optional(
          t.Union([
            t.Literal("breakfast"),
            t.Literal("lunch"),
            t.Literal("snack"),
            t.Literal("dinner"),
          ]),
        ),
        // minimum: 0 — see create handler (no negative servings/macros). PR #124.
        servings: t.Optional(t.Number({ minimum: 0 })),
        kcal: t.Optional(t.Number({ minimum: 0 })),
        proteinG: t.Optional(t.Number({ minimum: 0 })),
        carbsG: t.Optional(t.Number({ minimum: 0 })),
        fatG: t.Optional(t.Number({ minimum: 0 })),
        // Client-supplied label for one-off/AI entries — only touched when
        // present in the PATCH; absent leaves the existing value untouched.
        customName: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  );
