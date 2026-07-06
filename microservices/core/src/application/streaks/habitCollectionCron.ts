/**
 * Nightly COLLECTION habit-streak pass (18-habit-setup, Phase 18.5 —
 * T-18.5.2 / T-18.5.3). Runs in the 02:00 sweep BEFORE the generic miss-sweep
 * (streakCron.ts), mirroring nutritionCron.
 *
 * Per user with a collection habit streak, in order (design.md § 4.2/§ 4.3):
 *   1. **Promote pending config edits** whose `pending_from <= today` — the
 *      single point where deferred edits (target / days-per-week / leniency /
 *      enable-disable) become effective (§ 4.3 / T-18.5.3). Done first so the
 *      week just closing is scored against the config that was live all week and
 *      the promotion only affects the week now starting.
 *   2. **Holiday pause / resume** — if the just-completed week intersects a
 *      holiday range, the streak is neutral: `paused`, `last_period_end`
 *      advanced over the week, no count/token change (§ 4.2 step 1). A paused
 *      streak whose holiday has passed resumes to `active`.
 *   3. **Satisfied-week advance** — otherwise, run the M4 engine over the
 *      just-completed week; a satisfied "all habits met" week advances /
 *      earns-token / restarts exactly like every other streak. A NON-satisfied
 *      week is left behind its last-completed period for the generic
 *      `streakCron` sweep to apply the freeze-token / break mechanic.
 *   4. **Mid-week at-risk** — for the in-progress week, emit `streak_at_risk`
 *      when some habit can no longer reach its target with the days remaining
 *      and the streak has no token to absorb a miss (§ 4.2 / STORY-003 AC 3.5).
 *
 * `new Date()` is injected as `now` so the pass stays deterministic under test.
 */

import type { UserStreak } from "@persistence/db";
import { evaluateStreaks, type StreakDataPort } from "./engine";
import type { StreakNotifier } from "./engine";
import {
  compareISO,
  lastCompletedPeriodEndISO,
  localDateISO,
  periodEndForDateISO,
  periodStartFromEndISO,
} from "./period";
import { collectionAtRisk, type HabitWeekAggregate } from "./collection";

export interface HabitCollectionCronDataPort extends StreakDataPort {
  getCollectionHabitStreakUserIds(): Promise<string[]>;
  getCollectionHabitStreak(userId: string): Promise<UserStreak | null>;
  promoteHabitPendingEdits(userId: string, now: Date): Promise<number>;
  weekIntersectsHoliday(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<boolean>;
  getCollectionHabitAggregates(
    userId: string,
    startDate: string,
    endDate: string,
    tz: string,
  ): Promise<HabitWeekAggregate[]>;
  persistHolidayPause(
    streakId: string,
    fields: { lastPeriodEnd: string; snapshotLastPeriodEnd: string },
  ): Promise<UserStreak | null>;
  persistHolidayResume(streakId: string): Promise<UserStreak | null>;
}

export interface HabitCollectionCronDeps {
  data: HabitCollectionCronDataPort;
  notifier: StreakNotifier;
  now: Date;
}

export interface HabitCollectionCronSummary {
  users: number;
  promoted: number;
  paused: number;
  resumed: number;
  advanced: number;
  atRisk: number;
  failed: number;
}

export async function habitCollectionCron(
  deps: HabitCollectionCronDeps,
): Promise<HabitCollectionCronSummary> {
  const userIds = await deps.data.getCollectionHabitStreakUserIds();
  const summary: HabitCollectionCronSummary = {
    users: userIds.length,
    promoted: 0,
    paused: 0,
    resumed: 0,
    advanced: 0,
    atRisk: 0,
    failed: 0,
  };

  for (const userId of userIds) {
    // Per-user isolation: a bad IANA tz or a transient DB error on one user
    // must not abort the rest of the pass (mirrors nutritionCron / streakCron).
    try {
      // 1. Promote deferred config edits (§ 4.3).
      summary.promoted += await deps.data.promoteHabitPendingEdits(
        userId,
        deps.now,
      );

      const streak = await deps.data.getCollectionHabitStreak(userId);
      if (!streak) continue;

      const tz = await deps.data.getUserTimezone(userId);
      const today = localDateISO(deps.now, tz);
      // The most-recently-completed weekly period (last Sunday) and its Monday.
      const lastWeekEnd = lastCompletedPeriodEndISO(deps.now, "weekly", tz);
      const lastWeekStart = periodStartFromEndISO(lastWeekEnd, "weekly");

      // 2. Holiday pause / resume for the just-completed week.
      const weekInHoliday = await deps.data.weekIntersectsHoliday(
        userId,
        lastWeekStart,
        lastWeekEnd,
      );
      if (weekInHoliday) {
        // Only pause if the streak is behind (last_period_end < lastWeekEnd) —
        // otherwise it's already caught up and pausing would be a no-op churn.
        if (compareISO(streak.lastPeriodEnd, lastWeekEnd) < 0) {
          const paused = await deps.data.persistHolidayPause(streak.id, {
            lastPeriodEnd: lastWeekEnd,
            snapshotLastPeriodEnd: streak.lastPeriodEnd,
          });
          if (paused) summary.paused += 1;
        }
        // A holiday week is neutral — skip the advance + at-risk steps for it.
        continue;
      }

      // A paused streak whose holiday has now passed resumes (§ 4.3).
      if (streak.status === "paused") {
        const resumed = await deps.data.persistHolidayResume(streak.id);
        if (resumed) summary.resumed += 1;
      }

      // 3. Advance a satisfied just-completed week via the M4 engine (same
      //    advance / earn-token / restart path as every streak). Non-satisfied
      //    weeks are left for the generic streakCron to freeze/break.
      const result = await evaluateStreaks(
        userId,
        "habit_completed",
        deps.now,
        { data: deps.data, notifier: deps.notifier },
        { localDate: lastWeekEnd },
      );
      summary.advanced += result.advanced.length;

      // 4. Mid-week at-risk for the IN-PROGRESS week (§ 4.2). A streak with a
      //    token queued can absorb a miss, so no banner then.
      const fresh =
        (await deps.data.getCollectionHabitStreak(userId)) ?? streak;
      if (fresh.status !== "active" || fresh.freezeTokens > 0) continue;

      const curWeekEnd = periodEndForDateISO(today, "weekly");
      const curWeekStart = periodStartFromEndISO(curWeekEnd, "weekly");
      const aggregates = await deps.data.getCollectionHabitAggregates(
        userId,
        curWeekStart,
        curWeekEnd,
        tz,
      );
      // Days remaining in the current week, today INCLUSIVE (today can still
      // add a qualifying value/session).
      const remainingDays = daysBetweenInclusive(today, curWeekEnd);
      if (collectionAtRisk(aggregates, remainingDays)) {
        await deps.notifier.notify({
          userId,
          type: "streak_at_risk",
          title: "Your streak is at risk",
          message:
            "You can't hit every habit's target this week with the days left. Spend a freeze token to skip the week.",
          data: { streakType: "habit_streak", streakId: fresh.id },
          relatedEntityId: fresh.id,
        });
        summary.atRisk += 1;
      }
    } catch (err) {
      summary.failed += 1;
      console.error("[habit-collection-cron] failed for user", {
        userId,
        error: err,
      });
    }
  }

  return summary;
}

/** Whole days from `fromISO` to `toISO` inclusive (both YYYY-MM-DD). */
function daysBetweenInclusive(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T00:00:00.000Z`).getTime();
  const to = new Date(`${toISO}T00:00:00.000Z`).getTime();
  const diff = Math.round((to - from) / 86400000);
  return Math.max(0, diff) + 1;
}
