import Elysia, { t } from "elysia";
import { VolumeService } from "../repositories/volumeService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { addDaysISO } from "../streaks/period";
import { trailingRange, weekStartISO } from "./window";
import { fillWeekDays, computeDeltaPct } from "./volumeView";

/** Default weekly workout target (the "/5" in the prototype) until goal wiring. */
const WORKOUTS_TARGET_DEFAULT = 5;

function parseDays(window: string | undefined): number {
  if (!window) return 7;
  const m = /^(\d+)d$/.exec(window);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 31) : 7;
}

/**
 * GET /users/me/weekly-volume?window=7d — the Home WeeklyVolume card
 * (STORY-002 AC 2.4). Returns the daily bars plus the header stats (current
 * ISO-week total, ▲% vs last week, workouts done/target). All buckets are
 * user-local (cross-cuts § 3.4).
 */
export const getWeeklyVolumeHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(VolumeService)
  .get(
    "/users/me/weekly-volume",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const tz = await ctx.VolumeRepository.getUserTimezone(userId);
      const now = new Date();

      const days = parseDays(ctx.query.window);
      const { start, end } = trailingRange(now, days, tz);
      const daily = await ctx.VolumeRepository.dailyVolume(
        userId,
        tz,
        start,
        end,
      );

      const thisWeekStart = weekStartISO(now, tz);
      const thisWeekEnd = addDaysISO(thisWeekStart, 6);
      const lastWeekStart = addDaysISO(thisWeekStart, -7);
      const lastWeekEnd = addDaysISO(thisWeekStart, -1);

      const [thisKg, lastKg, completed] = await Promise.all([
        ctx.VolumeRepository.totalVolume(
          userId,
          tz,
          thisWeekStart,
          thisWeekEnd,
        ),
        ctx.VolumeRepository.totalVolume(
          userId,
          tz,
          lastWeekStart,
          lastWeekEnd,
        ),
        ctx.VolumeRepository.completedSessionCount(
          userId,
          tz,
          thisWeekStart,
          thisWeekEnd,
        ),
      ]);

      return {
        data: {
          days: fillWeekDays(daily, start, end),
          totalKg: thisKg,
          deltaPct: computeDeltaPct(thisKg, lastKg),
          workouts: { completed, target: WORKOUTS_TARGET_DEFAULT },
        },
      };
    },
    {
      query: t.Object({ window: t.Optional(t.String()) }),
    },
  );
