import Elysia, { t } from "elysia";
import { MealService } from "../../repositories/mealService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** GET /meals/:id — full meal with items (ownership in WHERE → 404). */
export const mealsGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MealService)
  .get(
    "/meals/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const meal = await ctx.MealRepository.getById(ctx.params.id, userId);
      if (!meal) {
        ctx.set.status = 404;
        return { error: "meal_not_found" };
      }
      return { data: meal };
    },
    { params: t.Object({ id: t.String() }) },
  );
