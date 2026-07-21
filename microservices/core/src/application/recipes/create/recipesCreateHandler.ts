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
 * POST /recipes — create a recipe (manual, URL-imported, or AI-estimated).
 *
 * Macro totals: the server materialises them from the ingredients' linked
 * foods (deterministic — STORY-006 AC 6.3). Free-text ingredients contribute
 * 0. When the recipe's macros came from a NON-ingredient source instead — a
 * URL import that carried Schema.org `nutrition`, or a whole-recipe AI
 * estimate — the client sends `providedTotals` (the whole-recipe totals it
 * displayed) and those are stored verbatim. This is the user's own recipe (no
 * cross-user trust boundary like `nutrition_entries`), so storing what the
 * user saw is correct and avoids a preview≠saved divergence. `providedTotals`
 * wins when present; otherwise we derive from ingredients.
 */
// Recipe ORIGIN (matches the `recipes.source` vocabulary in schema.ts).
// Orthogonal to how macros were derived — a whole-recipe AI *macro* estimate
// rides on `providedTotals`, not on `source`.
const ALLOWED_SOURCES = ["manual", "url_import", "ai_extracted"] as const;
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
      const foods = await ctx.FoodRepository.getByIds(foodIds, userId);
      const foodsById = new Map<string, FoodDTO>(foods.map((f) => [f.id, f]));
      const derived = materialiseTotals(ingredients, foodsById);

      // `providedTotals` (from a scrape / whole-recipe AI estimate) wins when
      // present — it's what the user saw. Otherwise derive from ingredients.
      const totals = roundTotals(ctx.body.providedTotals ?? derived);

      const recipe = await ctx.RecipeRepository.create(
        userId,
        {
          name: ctx.body.name,
          photoUrl: ctx.body.photoUrl,
          servings: ctx.body.servings,
          instructions: ctx.body.instructions,
          source: ctx.body.source ?? "manual",
          sourceUrl: ctx.body.sourceUrl,
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
        // servings must be positive (per-serving = total / servings); quantity
        // can't be negative (negative factor in materialiseTotals). PR #124.
        servings: t.Number({ exclusiveMinimum: 0 }),
        instructions: t.Optional(t.String()),
        source: t.Optional(t.Union(ALLOWED_SOURCES.map((s) => t.Literal(s)))),
        sourceUrl: t.Optional(t.String()),
        // Whole-recipe totals from a non-ingredient source (URL-import
        // `nutrition` or a whole-recipe AI estimate). Stored verbatim when
        // present; macros can't be negative.
        providedTotals: t.Optional(
          t.Object({
            kcal: t.Number({ minimum: 0 }),
            proteinG: t.Number({ minimum: 0 }),
            carbsG: t.Number({ minimum: 0 }),
            fatG: t.Number({ minimum: 0 }),
          }),
        ),
        ingredients: t.Array(
          t.Object({
            foodId: t.Optional(t.String()),
            customName: t.Optional(t.String()),
            quantity: t.Number({ minimum: 0 }),
            unit: t.String(),
            sortOrder: t.Integer({ minimum: 0 }),
          }),
        ),
      }),
    },
  );
