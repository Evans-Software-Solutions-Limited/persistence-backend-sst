import Elysia, { t } from "elysia";
import { MealService } from "../../repositories/mealService";
import { FoodService } from "../../repositories/foodService";
import { RecipeService } from "../../repositories/recipeService";
import { materialiseMealTotals } from "../services/materialiseMealMacros";
import { roundTotals } from "../../recipes/services/materialiseMacros";
import type { FoodDTO } from "../../repositories/foodRepository";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /meals — save a meal preset from logged foods/recipes (STORY-007). The
 * server materialises totals from the referenced foods + recipes
 * (deterministic): food item → per-serving × servings; recipe item →
 * (recipe total / recipe servings) × servings.
 */
export const mealsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MealService)
  .use(FoodService)
  .use(RecipeService)
  .post(
    "/meals",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { items } = ctx.body;

      const foodIds = [
        ...new Set(
          items.map((i) => i.foodId).filter((id): id is string => !!id),
        ),
      ];
      const recipeIds = [
        ...new Set(
          items.map((i) => i.recipeId).filter((id): id is string => !!id),
        ),
      ];

      const [foods, recipesById] = await Promise.all([
        ctx.FoodRepository.getByIds(foodIds),
        ctx.RecipeRepository.getMacroSummaries(recipeIds, userId),
      ]);
      const foodsById = new Map<string, FoodDTO>(foods.map((f) => [f.id, f]));
      const totals = roundTotals(
        materialiseMealTotals(items, foodsById, recipesById),
      );

      const meal = await ctx.MealRepository.create(
        userId,
        { name: ctx.body.name, photoUrl: ctx.body.photoUrl, items },
        totals,
      );

      ctx.set.status = 201;
      return { data: meal };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        photoUrl: t.Optional(t.String()),
        items: t.Array(
          t.Object({
            foodId: t.Optional(t.String()),
            recipeId: t.Optional(t.String()),
            servings: t.Number({ minimum: 0 }), // PR #124 — no negative servings
            sortOrder: t.Integer({ minimum: 0 }),
          }),
        ),
      }),
    },
  );
