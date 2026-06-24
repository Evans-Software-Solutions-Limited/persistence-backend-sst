import Elysia, { t } from "elysia";
import { MealService } from "../../repositories/mealService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** PUT /meals/:id — metadata (name/photo). Ownership in WHERE → 404. */
export const mealsUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MealService)
  .put(
    "/meals/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const updated = await ctx.MealRepository.update(
        ctx.params.id,
        userId,
        ctx.body,
      );
      if (!updated) {
        ctx.set.status = 404;
        return { error: "meal_not_found" };
      }
      return { data: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        photoUrl: t.Optional(t.String()),
      }),
    },
  );
