import Elysia, { t } from "elysia";
import { HomeReadService } from "../repositories/homeReadService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** Parse an `Nd` window to a day count; default 30, cap 366. */
export function parseBodyTrendWindow(window: string | undefined): number {
  if (!window) return 30;
  const m = /^(\d+)d$/.exec(window);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 366) : 30;
}

/**
 * GET /users/me/body-trend?window=30d — body-measurement series (oldest-first)
 * for the You/Progress sparkline + bar chart (STORY-003 AC 3.4).
 */
export const getBodyTrendHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HomeReadService)
  .get(
    "/users/me/body-trend",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const windowDays = parseBodyTrendWindow(ctx.query.window);
      const tz = await ctx.HomeReadRepository.getUserTimezone(userId);
      const series = await ctx.HomeReadRepository.getBodyTrend(
        userId,
        windowDays,
        tz,
      );
      return { data: series };
    },
    {
      query: t.Object({ window: t.Optional(t.String()) }),
    },
  );
