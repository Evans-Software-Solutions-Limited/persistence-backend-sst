import Elysia, { t } from "elysia";
import { HabitService } from "../repositories/habitService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /habit-completions?goalId=&window=7d — recent completions for the Home
 * habits grid (STORY-004 / cross-cuts § 3.3). `window` parses an `Nd` string
 * (default 7 days). Optional `goalId` restricts to one habit.
 */
export const listHabitCompletionsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HabitService)
  .get(
    "/habit-completions",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { goalId, window } = ctx.query;

      const windowDays = parseWindowDays(window);
      const completions = await ctx.HabitRepository.list(userId, {
        goalId,
        windowDays,
      });
      return { data: completions };
    },
    {
      query: t.Object({
        goalId: t.Optional(t.String()),
        window: t.Optional(t.String()),
      }),
    },
  );

/** Parse an `Nd` window string to a positive day count; default 7, cap 366. */
export function parseWindowDays(window: string | undefined): number {
  if (!window) return 7;
  const match = /^(\d+)d$/.exec(window);
  if (!match) return 7;
  const days = Number(match[1]);
  if (!Number.isFinite(days) || days <= 0) return 7;
  return Math.min(days, 366);
}
