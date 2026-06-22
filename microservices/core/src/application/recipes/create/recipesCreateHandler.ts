import Elysia, { t } from "elysia";
import { RecipeService } from "../../repositories/recipeService";
import { FoodService } from "../../repositories/foodService";
import { materialiseTotals, roundTotals } from "../services/materialiseMacros";
import type { FoodDTO } from "../../repositories/foodRepository";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /recipes — create a manual recipe. The server materialises the macro
 * totals from the ingredients' linked foods (deterministic, no AI — STORY-006
 * AC 6.3); free-text ingredients contribute 0 until the M9.5 AI estimate path.
 */
export const recipesCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(RecipeService)
  .use(FoodService)
  .post(
    "/recipes",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { ingredients } = ctx.body;

      const foodIds = [
        ...new Set(
          ingredients.map((i) => i.foodId).filter((id): id is string => !!id),
        ),
      ];
      const foods = await ctx.FoodRepository.getByIds(foodIds);
      const foodsById = new Map<string, FoodDTO>(foods.map((f) => [f.id, f]));
      const totals = roundTotals(materialiseTotals(ingredients, foodsById));

      const recipe = await ctx.RecipeRepository.create(
        userId,
        {
          name: ctx.body.name,
          photoUrl: ctx.body.photoUrl,
          servings: ctx.body.servings,
          instructions: ctx.body.instructions,
          source: "manual",
          ingredients,
        },
        totals,
      );

      ctx.set.status = 201;
      return { data: recipe };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        photoUrl: t.Optional(t.String()),
        servings: t.Number(),
        instructions: t.Optional(t.String()),
        ingredients: t.Array(
          t.Object({
            foodId: t.Optional(t.String()),
            customName: t.Optional(t.String()),
            quantity: t.Number(),
            unit: t.String(),
            sortOrder: t.Integer(),
          }),
        ),
      }),
    },
  );
