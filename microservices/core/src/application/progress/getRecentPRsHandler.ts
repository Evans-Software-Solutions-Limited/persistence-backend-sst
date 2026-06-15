import Elysia, { t } from "elysia";
import { HomeReadService } from "../repositories/homeReadService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /users/me/prs?limit=N — recent personal records, newest-first, joined to
 * exercise name (STORY-009). Powers the Home PR carousel (limit 5) + the
 * You/Progress PR history (limit 20). Ordering is always achieved_at desc.
 */
export const getRecentPRsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HomeReadService)
  .get(
    "/users/me/prs",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const raw = Number(ctx.query.limit);
      const limit =
        Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 50) : 5;
      const prs = await ctx.HomeReadRepository.getRecentPRs(userId, limit);
      return { data: prs };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        order: t.Optional(t.String()),
      }),
    },
  );
