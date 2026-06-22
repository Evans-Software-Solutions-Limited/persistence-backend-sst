import Elysia, { t } from "elysia";
import { MealService } from "../../repositories/mealService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** DELETE /meals/:id — ownership in WHERE → 404; items cascade. */
export const mealsDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MealService)
  .delete(
    "/meals/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const deleted = await ctx.MealRepository.delete(ctx.params.id, userId);
      if (!deleted) {
        ctx.set.status = 404;
        return { error: "meal_not_found" };
      }
      return { data: { id: ctx.params.id, deleted: true } };
    },
    { params: t.Object({ id: t.String() }) },
  );
