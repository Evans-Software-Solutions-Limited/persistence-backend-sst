import Elysia from "elysia";
import { VolumeService } from "../repositories/volumeService";
import { HomeReadService } from "../repositories/homeReadService";
import { HabitService } from "../repositories/habitService";
import { NutritionEntryService } from "../repositories/nutritionEntryService";
import { NutritionTargetService } from "../repositories/nutritionTargetService";
import { SleepService } from "../repositories/sleepService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { buildRings } from "./rings";
import { DEFAULT_GOAL_STEPS, DEFAULT_TARGET_KG } from "./loadRings";
import { weekStartISO, DEFAULT_WORKOUTS_PER_WEEK } from "./window";
import { addDaysISO, localDateISO } from "../streaks/period";
import { fillWeekDays, computeDeltaPct } from "./volumeView";
import { buildHabitsGrid } from "../habits/habitsView";
import { formatSleepDuration } from "./formatSleepDuration";

const RECENT_PR_LIMIT = 5;
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
  .use(NutritionEntryService)
  .use(NutritionTargetService)
  .use(SleepService)
  .get("/users/me/home", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const now = new Date();
    const tz = await ctx.VolumeRepository.getUserTimezone(userId);

    const today = localDateISO(now, tz);

    // Roll indefinite-programme occurrences forward BEFORE the reads so the
    // "Today's training" slice always has runway (specs/19-programs
    // § Materialisation). Error-tolerant: a top-up failure must not take down
    // the Home render — the already-materialised window still lists.
    try {
      await ctx.HomeReadRepository.ensureProgrammeMaterialized(userId, today);
    } catch (err) {
      console.error("home programme top-up failed", err);
    }
    // Bars + totals both span the current calendar week so `Σ bars === totalKg`
    // (Inspector finding — a trailing 7-day window disagreed with the Mon–Sun
    // total on any non-Sunday).
    const thisWeekStart = weekStartISO(now, tz);
    const thisWeekEnd = addDaysISO(thisWeekStart, 6);
    const lastWeekStart = addDaysISO(thisWeekStart, -7);
    const lastWeekEnd = addDaysISO(thisWeekStart, -1);

    // One fully-parallel fan-out. `thisKg` (the current Mon–Sun total) powers
    // BOTH the volume ring and the weekly-volume card, and `steps` feeds the
    // ring — computed once here and shared, not re-queried inside an awaited
    // loadRings(). Previously /users/me/home issued the identical Mon–Sun
    // totalVolume query twice AND serialised it behind `await loadRings` on the
    // cold-start path (Inspector finding, PR #116). loadRings stays for the
    // standalone GET /users/me/today-rings.
    const [
      steps,
      daily,
      thisKg,
      lastKg,
      completed,
      streak,
      recentPRs,
      completions,
      kcal,
      kcalTarget,
      activeProgramme,
      todaysTraining,
      sleepRecord,
    ] = await Promise.all([
      ctx.HomeReadRepository.getTodaySteps(userId, today),
      ctx.VolumeRepository.dailyVolume(userId, tz, thisWeekStart, thisWeekEnd),
      ctx.VolumeRepository.totalVolume(userId, tz, thisWeekStart, thisWeekEnd),
      ctx.VolumeRepository.totalVolume(userId, tz, lastWeekStart, lastWeekEnd),
      ctx.VolumeRepository.completedSessionCount(
        userId,
        tz,
        thisWeekStart,
        thisWeekEnd,
      ),
      ctx.HomeReadRepository.getActiveWorkoutStreakCount(userId),
      ctx.HomeReadRepository.getRecentPRs(userId, RECENT_PR_LIMIT),
      ctx.HabitRepository.list(userId, { windowDays: 7 }),
      ctx.NutritionEntryRepository.sumKcalForDay(userId, today),
      ctx.NutritionTargetRepository.get(userId).then(
        (t) => t?.dailyKcal ?? null,
      ),
      ctx.HomeReadRepository.getActiveProgramme(userId, today),
      ctx.HomeReadRepository.getTodaysTraining(userId, today),
      // specs/20-sleep-quicklog STORY-002 AC 2.5 — the same `today` basis the
      // rest of this handler already computes (user's local wake-day).
      ctx.SleepRepository.getForDate(userId, today),
    ]);

    const rings = buildRings(
      steps,
      DEFAULT_GOAL_STEPS,
      thisKg,
      DEFAULT_TARGET_KG,
      kcalTarget !== null ? { consumed: kcal, target: kcalTarget } : null,
    );

    return {
      data: {
        rings,
        micro: {
          streak,
          water: null,
          strain: null,
          sleep: formatSleepDuration(sleepRecord?.durationMinutes ?? null),
        },
        weeklyVolume: {
          days: fillWeekDays(
            daily,
            thisWeekStart,
            thisWeekEnd,
            localDateISO(now, tz),
          ),
          totalKg: thisKg,
          deltaPct: computeDeltaPct(thisKg, lastKg),
          workouts: { completed, target: DEFAULT_WORKOUTS_PER_WEEK },
        },
        recentPRs,
        habits: buildHabitsGrid(completions, now, tz),
        todayWorkout: [],
        // specs/19-programs STORY-005 — the athlete Home "Your programme"
        // card + "Today's training" section. Additive; null/[] when the
        // client has no live plan-visible programme.
        activeProgramme,
        todaysTraining,
      },
    };
  });
