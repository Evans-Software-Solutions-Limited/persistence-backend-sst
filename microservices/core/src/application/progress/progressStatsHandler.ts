import Elysia, { t } from "elysia";
import { ProgressService } from "../repositories/progressService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const progressStatsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProgressService)
  .get(
    "/progress/stats",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { from, to } = ctx.query;

      if (!from || !to) {
        ctx.set.status = 400;
        return { error: "from and to dates are required" };
      }

      const stats = await ctx.ProgressRepository.getStats(userId, from, to);
      return { data: stats };
    },
    {
      query: t.Object({
        from: t.String(),
        to: t.String(),
      }),
    },
  );
