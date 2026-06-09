import Elysia from "elysia";
import { VolumeService } from "../repositories/volumeService";
import { HomeReadService } from "../repositories/homeReadService";
import { HabitService } from "../repositories/habitService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { loadRings } from "./loadRings";
import { weekStartISO } from "./window";
import { addDaysISO } from "../streaks/period";
import { fillWeekDays, computeDeltaPct } from "./volumeView";
import { buildHabitsGrid } from "../habits/habitsView";

const RECENT_PR_LIMIT = 5;
const WORKOUTS_TARGET_DEFAULT = 5;

/**
 * GET /users/me/home — single-request aggregate for the Home cold-start render
 * (STORY-001/002): rings, micro-pills, the weekly-volume card, recent PRs, and
 * the 7-day habits grid. `todayWorkout` is intentionally served by the existing
 * workouts list (useGetMyWorkouts) rather than duplicated here — it is not on
 * the ring-render critical path. Each block is independently degradable.
 */
export const getHomeHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(VolumeService)
  .use(HomeReadService)
  .use(HabitService)
  .get("/users/me/home", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const now = new Date();
    const tz = await ctx.VolumeRepository.getUserTimezone(userId);

    const rings = await loadRings(
      {
        getUserTimezone: async () => tz,
        totalVolume: (u, z, s, e) =>
          ctx.VolumeRepository.totalVolume(u, z, s, e),
        getTodaySteps: (u, d) => ctx.HomeReadRepository.getTodaySteps(u, d),
      },
      userId,
      now,
    );

    // Bars + totals both span the current calendar week so `Σ bars === totalKg`
    // (Inspector finding — a trailing 7-day window disagreed with the Mon–Sun
    // total on any non-Sunday).
    const thisWeekStart = weekStartISO(now, tz);
    const thisWeekEnd = addDaysISO(thisWeekStart, 6);
    const lastWeekStart = addDaysISO(thisWeekStart, -7);
    const lastWeekEnd = addDaysISO(thisWeekStart, -1);

    const [daily, thisKg, lastKg, completed, streak, recentPRs, completions] =
      await Promise.all([
        ctx.VolumeRepository.dailyVolume(
          userId,
          tz,
          thisWeekStart,
          thisWeekEnd,
        ),
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
        ctx.HomeReadRepository.getActiveWorkoutStreakCount(userId),
        ctx.HomeReadRepository.getRecentPRs(userId, RECENT_PR_LIMIT),
        ctx.HabitRepository.list(userId, { windowDays: 7 }),
      ]);

    return {
      data: {
        rings,
        micro: { streak, water: null, strain: null, sleep: null },
        weeklyVolume: {
          days: fillWeekDays(daily, thisWeekStart, thisWeekEnd),
          totalKg: thisKg,
          deltaPct: computeDeltaPct(thisKg, lastKg),
          workouts: { completed, target: WORKOUTS_TARGET_DEFAULT },
        },
        recentPRs,
        habits: buildHabitsGrid(completions, now, tz),
        todayWorkout: [],
      },
    };
  });
