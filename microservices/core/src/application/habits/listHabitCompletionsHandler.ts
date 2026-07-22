import Elysia, { t } from "elysia";
import { HabitService } from "../repositories/habitService";
import { StreakReadService } from "../repositories/streakReadService";
import { habitsGridWindow } from "./habitsView";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /habit-completions?goalId=&window=7d&includeDerived= — recent
 * completions for the Home habits grid (STORY-004 / cross-cuts § 3.3).
 * `window` parses an `Nd` string (default 7 days). Optional `goalId`
 * restricts to one habit.
 *
 * `includeDerived=true` (BRIEF-7 QA-1..QA-4 mobile half) additionally folds
 * in SYNTHETIC completion rows for the Gym/Calories habits — categories that
 * never write a real `habit_completions` row (Gym is a logged
 * `workout_session` count; Calories is scored off `nutrition_entries`) — so
 * the mobile grid, which reads this endpoint directly rather than
 * `GET /users/me/home`, can tick them the same way the Home aggregate
 * already does (`StreakRepository.getDerivedHabitGridRows`). Defaults to
 * `false` so every OTHER existing caller of this endpoint (and of
 * `HabitRepository.list`, which is unchanged) sees byte-identical behaviour.
 */
export const listHabitCompletionsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HabitService)
  .use(StreakReadService)
  .get(
    "/habit-completions",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { goalId, window, includeDerived } = ctx.query;

      const windowDays = parseWindowDays(window);
      const completions = await ctx.HabitRepository.list(userId, {
        goalId,
        windowDays,
      });

      if (!parseIncludeDerived(includeDerived)) {
        return { data: completions };
      }

      const tz = await ctx.StreakRepository.getUserTimezone(userId);
      const derivedWindow = habitsGridWindow(new Date(), tz, windowDays);
      const derived = await ctx.StreakRepository.getDerivedHabitCompletions(
        userId,
        derivedWindow,
        tz,
      );
      const scopedDerived = goalId
        ? derived.filter((d) => d.goalId === goalId)
        : derived;

      return { data: [...completions, ...scopedDerived] };
    },
    {
      query: t.Object({
        goalId: t.Optional(t.String()),
        window: t.Optional(t.String()),
        includeDerived: t.Optional(t.String()),
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

/** Parse the `includeDerived` query flag; default false (opt-in only). */
export function parseIncludeDerived(value: string | undefined): boolean {
  return value === "true";
}
