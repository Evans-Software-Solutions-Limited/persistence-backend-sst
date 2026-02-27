import Elysia, { t } from "elysia";
import { GoalService } from "../../repositories/goalService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const goalsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(GoalService)
  .get(
    "/goals",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { limit, offset } = ctx.query;

      const goals = await ctx.GoalRepository.list(
        userId,
        limit ?? 20,
        offset ?? 0,
      );

      return { data: goals };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    },
  );
