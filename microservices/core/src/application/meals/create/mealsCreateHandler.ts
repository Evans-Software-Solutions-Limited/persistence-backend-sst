import Elysia, { t } from "elysia";
import { MealService } from "../../repositories/mealService";
import { FoodService } from "../../repositories/foodService";
import { RecipeService } from "../../repositories/recipeService";
import { materialiseMealTotals } from "../services/materialiseMealMacros";
import { roundTotals } from "../../recipes/services/materialiseMacros";
import type { FoodDTO } from "../../repositories/foodRepository";
import { NutritionSourceUnavailableError } from "../../repositories/nutritionDataValidity";
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
        ctx.FoodRepository.getByIds(foodIds, userId),
        ctx.RecipeRepository.getMacroSummaries(recipeIds, userId),
      ]);
      const foodsById = new Map<string, FoodDTO>(foods.map((f) => [f.id, f]));
      const unresolved = [
        ...foodIds.filter((id) => !foodsById.has(id)).map((id) => `food:${id}`),
        ...recipeIds
          .filter((id) => !recipesById.has(id))
          .map((id) => `recipe:${id}`),
      ];
      if (unresolved.length > 0) {
        ctx.set.status = 400;
        return { error: "unresolvable_items", items: unresolved };
      }
      const totals = roundTotals(
        materialiseMealTotals(items, foodsById, recipesById),
      );

      let meal;
      try {
        meal = await ctx.MealRepository.create(
          userId,
          { name: ctx.body.name, photoUrl: ctx.body.photoUrl, items },
          totals,
        );
      } catch (error) {
        if (error instanceof NutritionSourceUnavailableError) {
          ctx.set.status = 409;
          return { error: "nutrition_source_changed", items: error.items };
        }
        throw error;
      }

      ctx.set.status = 201;
      return { data: meal };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        // ⚠ PRIVACY POLICY DEPENDENCY: the published policy states "the images
        // and text you submit are not stored ... there is no photo library of
        // your meals, recipes or gym on our servers". That claim is true today
        // only because NO client ever sets this field — there is no meal-photo
        // bucket, and the AI estimate path holds the image in memory and
        // discards it. Wiring up meal-photo upload therefore falsifies a live
        // privacy claim: update `packages/web/src/pages/Privacy.tsx` AND
        // `packages/mobile/.../PrivacyPolicyPresenter.tsx` in the same change.
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
