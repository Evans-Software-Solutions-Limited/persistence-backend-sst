import Elysia from "elysia";
import { VolumeService } from "../repositories/volumeService";
import { HomeReadService } from "../repositories/homeReadService";
import { HabitConfigService } from "../repositories/habitConfigService";
import { HabitService } from "../repositories/habitService";
import { StreakReadService } from "../repositories/streakReadService";
import { NutritionEntryService } from "../repositories/nutritionEntryService";
import { NutritionTargetService } from "../repositories/nutritionTargetService";
import { SleepService } from "../repositories/sleepService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { loadHome } from "./loadHome";

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
  .use(HabitConfigService)
  .use(HabitService)
  .use(StreakReadService)
  .use(NutritionEntryService)
  .use(NutritionTargetService)
  .use(SleepService)
  .get("/users/me/home", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    return { data: await loadHome(ctx, userId) };
  });
