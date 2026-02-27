import Elysia, { t } from "elysia";
import { GoalService } from "../../repositories/goalService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const goalsGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(GoalService)
  .get(
    "/goals/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;

      const goal = await ctx.GoalRepository.getById(id, userId);

      if (!goal) {
        ctx.set.status = 404;
        return { error: "Goal not found" };
      }

      return { data: goal };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
