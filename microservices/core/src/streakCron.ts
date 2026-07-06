import { streakCron } from "./application/streaks/cron";
import { nutritionStreakCron } from "./application/streaks/nutritionCron";
import { habitCollectionCron } from "./application/streaks/habitCollectionCron";
import { StreakRepository } from "./application/repositories/streakRepository";
import { StreakNotificationDispatcher } from "./application/streaks/notifier";

/**
 * Nightly streak sweep — scheduled at 02:00 UTC via `sst.aws.Cron` in
 * infra/api.ts (06-progress-goals, Phase 06.2; cross-cuts § 3.4).
 *
 * Two passes, in order:
 *  1. Nutrition advance (M9) — nutrition_streak can't advance on-write (the
 *     daily total is volatile until day-close), so this pass evaluates each
 *     user's most-recently-completed local day and advances satisfied streaks.
 *  2. Generic miss-sweep — any streak (incl. a nutrition streak that pass 1 did
 *     NOT advance) left behind its last-completed period gets a freeze token
 *     (quiet recovery) or is broken.
 *
 * `new Date()` is read here (the impure edge); the engine + cron logic take an
 * injected clock so they stay deterministic under test.
 */
export async function handler(): Promise<{
  swept: number;
  upToDate: number;
  frozen: number;
  broken: number;
  nutritionUsers: number;
  nutritionAdvanced: number;
  nutritionFailed: number;
  habitUsers: number;
  habitPromoted: number;
  habitPaused: number;
  habitResumed: number;
  habitAdvanced: number;
  habitAtRisk: number;
  habitFailed: number;
}> {
  const data = new StreakRepository();
  const notifier = new StreakNotificationDispatcher();
  const now = new Date();

  // Pass 1: advance satisfied nutrition streaks for the just-completed day,
  // BEFORE the generic sweep so an advanced streak reads as up-to-date there.
  const nutrition = await nutritionStreakCron({ data, notifier, now });
  console.log(`[nutrition-streak-cron:summary] ${JSON.stringify(nutrition)}`);

  // Pass 1.5: collection habit streaks (18-habit-setup) — promote pending
  // config edits, apply holiday pause/resume, advance satisfied weeks, and emit
  // mid-week at-risk. BEFORE the generic sweep so paused/advanced rows read as
  // up-to-date (or excluded, when paused) there.
  const habit = await habitCollectionCron({ data, notifier, now });
  console.log(`[habit-collection-cron:summary] ${JSON.stringify(habit)}`);

  // Pass 2: generic miss/freeze/break sweep across all active streaks.
  const summary = await streakCron({ data, notifier, now });
  console.log(`[streak-cron:summary] ${JSON.stringify(summary)}`);

  return {
    ...summary,
    nutritionUsers: nutrition.users,
    nutritionAdvanced: nutrition.advanced,
    nutritionFailed: nutrition.failed,
    habitUsers: habit.users,
    habitPromoted: habit.promoted,
    habitPaused: habit.paused,
    habitResumed: habit.resumed,
    habitAdvanced: habit.advanced,
    habitAtRisk: habit.atRisk,
    habitFailed: habit.failed,
  };
}
