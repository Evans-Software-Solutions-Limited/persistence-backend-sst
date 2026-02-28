import Elysia, { t } from "elysia";
import { GoalService } from "../../repositories/goalService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const goalsDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(GoalService)
  .delete(
    "/goals/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;

      const deleted = await ctx.GoalRepository.delete(id, userId);

      if (!deleted) {
        ctx.set.status = 404;
        return { error: "Goal not found" };
      }

      return { data: { success: true } };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
