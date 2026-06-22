/**
 * Nightly nutrition-streak ADVANCE pass (M9, 13-nutrition-tracking). Runs in the
 * 02:00 streak sweep BEFORE the generic miss-sweep (cron.ts).
 *
 * Unlike workout/habit/measurement streaks — which the on-write engine advances
 * the instant an event satisfies the period — a nutrition day's "within target
 * ±10%" is volatile until the day closes (more logging can push an in-range day
 * to over). So the durable advance can't happen on-write; this pass evaluates
 * each user's most-recently-completed user-local day and advances the streak via
 * the same engine (so freeze-token / milestone / restart logic is identical).
 *
 * Any streak NOT advanced here (day out of range, or nothing logged) is left
 * behind its last-completed period — the generic `streakCron` sweep that runs
 * next then applies the freeze-token / break mechanic to it.
 *
 * The immediate "you hit your goal" reward is a separate, instant client-side
 * concern (design.md § Immediate in-app reward) — this pass is the durable
 * bookkeeping only. The `daily_nutrition_target_hit` push is deferred (default
 * opt-in is off; the in-app reward covers the felt moment).
 */

import { evaluateStreaks, type StreakDataPort } from "./engine";
import type { StreakNotifier } from "./engine";
import { addDaysISO, localDateISO } from "./period";

export interface NutritionStreakCronDataPort extends StreakDataPort {
  getNutritionStreakUserIds(): Promise<string[]>;
}

export interface NutritionStreakCronDeps {
  data: NutritionStreakCronDataPort;
  notifier: StreakNotifier;
  now: Date;
}

export interface NutritionStreakCronSummary {
  users: number;
  advanced: number;
  failed: number;
}

export async function nutritionStreakCron(
  deps: NutritionStreakCronDeps,
): Promise<NutritionStreakCronSummary> {
  const userIds = await deps.data.getNutritionStreakUserIds();
  const summary: NutritionStreakCronSummary = {
    users: userIds.length,
    advanced: 0,
    failed: 0,
  };

  for (const userId of userIds) {
    // Per-user isolation: a bad IANA tz or a transient DB error on one user must
    // not abort the rest of the pass (mirrors streakCron / volumeCron).
    try {
      const tz = await deps.data.getUserTimezone(userId);
      // The most-recently-completed daily period is always "local yesterday":
      // today is never complete until local midnight, whatever the wall-clock.
      const completedDay = addDaysISO(localDateISO(deps.now, tz), -1);
      const result = await evaluateStreaks(
        userId,
        "nutrition_in_target",
        deps.now,
        { data: deps.data, notifier: deps.notifier },
        { localDate: completedDay },
      );
      summary.advanced += result.advanced.length;
    } catch (err) {
      summary.failed += 1;
      console.error("[nutrition-streak-cron] advance failed for user", {
        userId,
        error: err,
      });
    }
  }

  return summary;
}
