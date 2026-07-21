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
 * POST /nutrition/entries — log a food/recipe/meal entry into a meal slot.
 *
 * Macro authority: the server RE-DERIVES macros from the referenced row ×
 * servings and never trusts client math (BACKEND_BRIEF § 2):
 * - `foodId` → the food's per-serving macros × `servings`.
 * - `recipeId` → the recipe's PER-SERVING macros (`total_* / recipe.servings`)
 *   × `servings`. A recipe stores whole-recipe totals, so logging N servings
 *   is N portions of the dish, not N whole recipes.
 * - `mealId` → the meal's total (a meal preset is itself one serving) ×
 *   `servings`.
 * Only a true one-off (no reference) uses client-supplied macros.
 *
 * Fixing this closed a production crash: recipe/meal logs sent only the ref +
 * servings (no macros), the handler derived nothing for them, hit the
 * "macros required" guard → 400, and the sync queue retried the permanent 400
 * to exhaustion (`nutrition_entry/create` Sentry).
 */
export const nutritionEntriesCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionEntryService)
  .use(FoodService)
  .use(RecipeService)
  .use(MealService)
  .post(
    "/nutrition/entries",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const body = ctx.body;

      let kcal = body.kcal;
      let proteinG = body.proteinG;
      let carbsG = body.carbsG;
      let fatG = body.fatG;

      if (body.foodId) {
        const food = await ctx.FoodRepository.getById(body.foodId, userId);
        if (!food) {
          ctx.set.status = 400;
          return { error: "food_not_found" };
        }
        // Server-authoritative: per-serving macros × servings count.
        kcal = food.kcal * body.servings;
        proteinG = food.proteinG * body.servings;
        carbsG = food.carbsG * body.servings;
        fatG = food.fatG * body.servings;
      } else if (body.recipeId) {
        const recipe = await ctx.RecipeRepository.getById(
          body.recipeId,
          userId,
        );
        if (!recipe) {
          ctx.set.status = 400;
          return { error: "recipe_not_found" };
        }
        // Recipe totals are whole-recipe; a logged serving is one portion, so
        // scale per-serving (total / recipe.servings) by the logged count. A
        // 0/invalid servings count falls back to 1 to avoid divide-by-zero.
        const perServing = recipe.servings > 0 ? recipe.servings : 1;
        const factor = body.servings / perServing;
        kcal = (recipe.totalKcal ?? 0) * factor;
        proteinG = (recipe.totalProteinG ?? 0) * factor;
        carbsG = (recipe.totalCarbsG ?? 0) * factor;
        fatG = (recipe.totalFatG ?? 0) * factor;
      } else if (body.mealId) {
        const meal = await ctx.MealRepository.getById(body.mealId, userId);
        if (!meal) {
          ctx.set.status = 400;
          return { error: "meal_not_found" };
        }
        // A saved meal preset is itself one serving — scale its total by count.
        kcal = meal.totalKcal * body.servings;
        proteinG = meal.totalProteinG * body.servings;
        carbsG = meal.totalCarbsG * body.servings;
        fatG = meal.totalFatG * body.servings;
      }

      if (
        kcal === undefined ||
        proteinG === undefined ||
        carbsG === undefined ||
        fatG === undefined
      ) {
        ctx.set.status = 400;
        return { error: "macros_required_for_custom_entry" };
      }

      const entry = await ctx.NutritionEntryRepository.create(userId, {
        foodId: body.foodId ?? null,
        recipeId: body.recipeId ?? null,
        mealId: body.mealId ?? null,
        mealSlot: body.mealSlot,
        servings: body.servings,
        kcal,
        proteinG,
        carbsG,
        fatG,
        loggedAt: body.loggedAt,
        customName: body.customName ?? null,
      });

      ctx.set.status = 201;
      return { data: entry };
    },
    {
      body: t.Object({
        foodId: t.Optional(t.String()),
        recipeId: t.Optional(t.String()),
        mealId: t.Optional(t.String()),
        mealSlot: t.Union([
          t.Literal("breakfast"),
          t.Literal("lunch"),
          t.Literal("snack"),
          t.Literal("dinner"),
        ]),
        // minimum: 0 — negative servings/macros would let a client subtract
        // kcal from their day (and trivially flip the streak). The DB has no
        // CHECK, so validate here. Review fix (PR #124).
        servings: t.Number({ minimum: 0 }),
        kcal: t.Optional(t.Number({ minimum: 0 })),
        proteinG: t.Optional(t.Number({ minimum: 0 })),
        carbsG: t.Optional(t.Number({ minimum: 0 })),
        fatG: t.Optional(t.Number({ minimum: 0 })),
        loggedAt: t.String(),
        // Client-supplied label for one-off/AI entries — stored/returned
        // verbatim, never derived or validated against a food (BRIEF).
        customName: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  );
