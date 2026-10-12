import type { VolumeRepository } from "../repositories/volumeRepository";
import type { HabitConfigRepository } from "../repositories/habitConfigRepository";
import { localDateISO } from "../streaks/period";
import { parseWindowKind, windowStartISO } from "./window";
import {
  withMusclePct,
  adherencePct,
  daysBetweenInclusive,
} from "./volumeView";

export type VolumeStatsRepositories = {
  VolumeRepository: VolumeRepository;
  HabitConfigRepository: HabitConfigRepository;
};

export type VolumeStatsData = Awaited<ReturnType<typeof loadVolumeStats>>;

/**
 * Everything `GET /users/me/volume-stats` returns for a window. Shared by the
 * route and by `GET /users/me/bootstrap`.
 */
export async function loadVolumeStats(
  ctx: VolumeStatsRepositories,
  userId: string,
  window: string | undefined,
  now: Date = new Date(),
) {
  const tz = await ctx.VolumeRepository.getUserTimezone(userId);

  const kind = parseWindowKind(window);
  const start = windowStartISO(now, kind, tz);
  const end = localDateISO(now, tz);

  // Recompute the requested window's by-muscle materialisation on every
  // read. `workouts`/`totalKg` below are computed live from the source
  // tables, so a stale materialised row would visibly disagree with the
  // headline — and the cron only refreshes `month` (Inspector finding:
  // quarter/year/lifetime would never update after their first cold write).
  // This is the low-frequency You/Progress path, so a recompute-on-read
  // (a small delete+insert of per-muscle rows) is cheap + always consistent.
  //
  // Guarded (Cluster 1a Task 2): a throw here used to 500 the WHOLE
  // request, disappearing the You-page card entirely even though
  // `workouts`/`totalKg` below are independently computable. Degrade
  // instead — log and keep serving the live totals with `byMuscle: []`
  // rather than skip the (freshly failing) by-muscle read and risk
  // silently serving a STALE materialised row.
  let recomputeFailed = false;
  try {
    await ctx.VolumeRepository.recomputeVolumeByMuscle(
      userId,
      tz,
      kind,
      start,
      end,
    );
  } catch (err) {
    recomputeFailed = true;
    console.error("[volume-stats] recompute failed, degrading to []", {
      userId,
      kind,
      error: err,
    });
  }

  const [workouts, totalKg, byMuscleRaw, weeklyWorkoutTarget] =
    await Promise.all([
      ctx.VolumeRepository.completedSessionCount(userId, tz, start, end),
      ctx.VolumeRepository.totalVolume(userId, tz, start, end),
      recomputeFailed
        ? Promise.resolve([])
        : ctx.VolumeRepository.getVolumeByMuscle(userId, kind, start),
      ctx.HabitConfigRepository.getActiveTarget(userId, "gym", "weekly"),
    ]);

  const adherence =
    kind === "lifetime" || weeklyWorkoutTarget === null
      ? null
      : adherencePct(
          workouts,
          weeklyWorkoutTarget,
          daysBetweenInclusive(start, end),
        );

  return {
    window: kind,
    workouts,
    totalKg,
    totalTonnes: Math.round(totalKg / 100) / 10,
    adherencePct: adherence,
    byMuscle: withMusclePct(byMuscleRaw),
  };
}
