/**
 * Volume re-materialisation (06-progress-goals, Phase 06.4). Recomputes a
 * user's current-week total + current-month by-muscle breakdown. Called two
 * ways: by the 03:00 cron (sweep all users) and as a fire-and-forget backup
 * after a session completes, so Home/You never show stale weekly volume even
 * between cron runs (design.md § Risks — two-write redundancy).
 */

import { VolumeRepository } from "../repositories/volumeRepository";
import { addDaysISO, localDateISO } from "../streaks/period";
import { weekStartISO, windowStartISO } from "./window";

/** Recompute the week + month aggregates for one user. Throws on DB error. */
export async function recomputeUserVolume(
  repo: VolumeRepository,
  userId: string,
  now: Date,
): Promise<void> {
  const tz = await repo.getUserTimezone(userId);

  const ws = weekStartISO(now, tz);
  await repo.recomputeWeeklyVolume(userId, tz, ws, addDaysISO(ws, 6));

  const ms = windowStartISO(now, "month", tz);
  await repo.recomputeVolumeByMuscle(
    userId,
    tz,
    "month",
    ms,
    localDateISO(now, tz),
  );
}

/**
 * Error-tolerant on-write backup recompute. Mirrors safeEvaluateStreaks: the
 * triggering write already committed, so a recompute failure must not fail the
 * request — the nightly cron will catch up.
 */
export async function safeRecomputeVolume(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    await recomputeUserVolume(new VolumeRepository(), userId, now);
  } catch (err) {
    console.error("[volume] on-write recompute failed", { userId, error: err });
  }
}
