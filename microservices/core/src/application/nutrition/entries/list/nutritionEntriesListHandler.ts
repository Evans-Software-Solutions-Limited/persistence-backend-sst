import Elysia, { t } from "elysia";
import { NutritionEntryService } from "../../../repositories/nutritionEntryService";
import { UserMealService } from "../../../repositories/userMealService";
import {
  needsUserMeals,
  withEffectiveUserMealIds,
} from "../../userMeals/effectiveUserMeal";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /nutrition/entries?date=YYYY-MM-DD — a day's entries, newest first.
 *
 * Each entry carries `userMealId` (Design D): its own, or — for entries
 * logged without one — the default meal for its slot. Older apps ignore it.
 */
export const nutritionEntriesListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionEntryService)
  .use(UserMealService)
  .get(
    "/nutrition/entries",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const entries = await ctx.NutritionEntryRepository.listByDate(
        userId,
        ctx.query.date,
      );
      if (!needsUserMeals(entries)) return { data: entries };
      const meals = await ctx.UserMealRepository.listActive(userId);
      return { data: withEffectiveUserMealIds(entries, meals) };
    },
    {
      query: t.Object({
        date: t.String(),
      }),
    },
  );
