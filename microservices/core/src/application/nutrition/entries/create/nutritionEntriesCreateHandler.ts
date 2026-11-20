import Elysia from "elysia";
import { NutritionEntryService } from "../../../repositories/nutritionEntryService";
import { FoodService } from "../../../repositories/foodService";
import { RecipeService } from "../../../repositories/recipeService";
import { MealService } from "../../../repositories/mealService";
import { UserMealService } from "../../../repositories/userMealService";
import { readIdempotencyKey } from "../../../shared/idempotencyKey";
import { entryBodySchema, resolveEntryInput } from "../resolveEntryInput";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /nutrition/entries — log a food/recipe/meal entry into a meal slot.
 *
 * Macros are re-derived server-side from the referenced row × servings; see
 * `resolveEntryInput`. That closed a production crash: recipe/meal logs sent
 * only the ref + servings (no macros), the handler derived nothing for them,
 * hit the "macros required" guard → 400, and the sync queue retried the
 * permanent 400 to exhaustion (`nutrition_entry/create` Sentry).
 *
 * Replay-safe (Design D, PER-109): the `Idempotency-Key` header is stored as
 * `client_request_id`. The 1.2.0 sync queue already sends one on every queued
 * log, so a log re-sent after a lost response returns the first row (201, same
 * body) instead of adding a duplicate — for 1.2.0 phones too. No header keeps
 * exactly the old behaviour.
 *
 * Optional `userMealId` (Design D "Your meals"): must be the caller's; the
 * server then sets `mealSlot` from that meal's `logSlot`.
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
  .use(UserMealService)
  .post(
    "/nutrition/entries",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const key = readIdempotencyKey(ctx.headers);

      // A replay short-circuits BEFORE re-deriving macros: the food it named
      // may have been deleted since, and the committed row is the answer.
      if (key !== null) {
        const existing =
          await ctx.NutritionEntryRepository.getByClientRequestId(userId, key);
        if (existing) {
          ctx.set.status = 201;
          return { data: existing };
        }
      }

      const resolved = await resolveEntryInput(ctx, userId, ctx.body);
      if (!resolved.ok) {
        ctx.set.status = 400;
        return { error: resolved.error };
      }

      const entry = await ctx.NutritionEntryRepository.create(userId, {
        ...resolved.input,
        clientRequestId: key,
      });

      ctx.set.status = 201;
      return { data: entry };
    },
    {
      body: entryBodySchema,
    },
  );
