import Elysia, { t } from "elysia";
import { UserMealService } from "../../../repositories/userMealService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /nutrition/user-meals — Your meals (Design D, N1b), in display order.
 *
 * Seeds the four defaults (Breakfast, Lunch, Snack, Dinner) the first time,
 * idempotently. `?includeArchived=true` adds removed meals, which the phone
 * needs to label past entries still pointing at them.
 */
export const nutritionUserMealsGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(UserMealService)
  .get(
    "/nutrition/user-meals",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const meals = await ctx.UserMealRepository.list(userId, {
        includeArchived: ctx.query.includeArchived === "true",
      });
      return { data: { meals, asOf: new Date().toISOString() } };
    },
    {
      query: t.Object({
        includeArchived: t.Optional(
          t.Union([t.Literal("true"), t.Literal("false")]),
        ),
      }),
    },
  );
