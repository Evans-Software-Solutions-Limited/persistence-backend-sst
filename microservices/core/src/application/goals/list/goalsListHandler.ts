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
      const { limit = "20", offset = "0" } = ctx.query as Record<
        string,
        string
      >;

      const goals = await ctx.GoalRepository.list(
        userId,
        parseInt(limit, 10),
        parseInt(offset, 10),
      );

      return { data: goals };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  );
