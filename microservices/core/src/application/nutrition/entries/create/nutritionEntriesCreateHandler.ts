import Elysia, { t } from "elysia";
import { NutritionEntryService } from "../../../repositories/nutritionEntryService";
import { FoodService } from "../../../repositories/foodService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /nutrition/entries — log a food/recipe/meal entry into a meal slot.
 *
 * Macro authority: when `foodId` is supplied the server RE-DERIVES the macros
 * from the referenced `foods` row × servings (never trusts client math, per
 * BACKEND_BRIEF § 2). For a true one-off (no reference) the client-supplied
 * macros are used. recipe/meal references carry server-materialised totals
 * already, so their client-supplied macros are accepted in M9; full server-side
 * recipe/meal re-derivation lands with those repositories.
 */
export const nutritionEntriesCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionEntryService)
  .use(FoodService)
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
        const food = await ctx.FoodRepository.getById(body.foodId);
        if (!food) {
          ctx.set.status = 400;
          return { error: "food_not_found" };
        }
        // Server-authoritative: per-serving macros × servings count.
        kcal = food.kcal * body.servings;
        proteinG = food.proteinG * body.servings;
        carbsG = food.carbsG * body.servings;
        fatG = food.fatG * body.servings;
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
        servings: t.Number(),
        kcal: t.Optional(t.Number()),
        proteinG: t.Optional(t.Number()),
        carbsG: t.Optional(t.Number()),
        fatG: t.Optional(t.Number()),
        loggedAt: t.String(),
      }),
    },
  );
