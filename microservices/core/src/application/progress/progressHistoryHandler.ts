import Elysia, { t } from "elysia";
import { ProgressService } from "../repositories/progressService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const progressHistoryHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProgressService)
  .get(
    "/progress/history",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { limit, offset } = ctx.query;

      const history = await ctx.ProgressRepository.getHistory(
        userId,
        limit ? parseInt(limit) : 20,
        offset ? parseInt(offset) : 0,
      );
      return { data: history };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  );
