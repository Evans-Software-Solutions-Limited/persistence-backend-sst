/**
 * Nightly streak sweep (06-progress-goals, Phase 06.2). Per cross-cuts § 3.4
 * (item 2) + § 3.5. Scheduled at 02:00 UTC (infra/api.ts).
 *
 * The on-write engine (engine.ts) advances `last_period_end` whenever a period
 * is satisfied. So at sweep time, any active streak whose `last_period_end` is
 * behind the most-recently-completed user-local period must have MISSED that
 * period. For each miss:
 *   - freeze_tokens > 0  → spend one, keep the streak alive, emit
 *     `freeze_token_applied`, fast-forward last_period_end. (Quiet recovery —
 *     no celebration; § 3.5.)
 *   - else               → break it (status='broken', current_count=0). No
 *     notification — `streak_lost` is not a defined notification type.
 *
 * Data access + notification are injected ports (testable without a DB or a
 * real clock).
 */

import type { UserStreak } from "@persistence/db";
import { lastCompletedPeriodEndISO, compareISO, type Period } from "./period";
import type { StreakNotifier } from "./engine";

export interface StreakCronDataPort {
  getActiveStreaks(): Promise<UserStreak[]>;
  getUserTimezone(userId: string): Promise<string>;
  persistFreezeSpend(
    streakId: string,
    fields: { freezeTokens: number; lastPeriodEnd: string },
  ): Promise<UserStreak>;
  persistBreak(
    streakId: string,
    fields: { lastPeriodEnd: string },
  ): Promise<UserStreak>;
}

export interface StreakCronDeps {
  data: StreakCronDataPort;
  notifier: StreakNotifier;
  /** Injected for deterministic tests; the handler passes `new Date()`. */
  now: Date;
}

export interface StreakCronSummary {
  swept: number;
  upToDate: number;
  frozen: number;
  broken: number;
}

export async function streakCron(
  deps: StreakCronDeps,
): Promise<StreakCronSummary> {
  const streaks = await deps.data.getActiveStreaks();
  const summary: StreakCronSummary = {
    swept: streaks.length,
    upToDate: 0,
    frozen: 0,
    broken: 0,
  };

  // Memoise tz per user across the sweep — many streaks share a user.
  const tzCache = new Map<string, string>();
  const tzFor = async (userId: string): Promise<string> => {
    const cached = tzCache.get(userId);
    if (cached !== undefined) return cached;
    const tz = await deps.data.getUserTimezone(userId);
    tzCache.set(userId, tz);
    return tz;
  };

  for (const streak of streaks) {
    const period = streak.period as Period;
    const tz = await tzFor(streak.userId);
    const lastCompletedEnd = lastCompletedPeriodEndISO(deps.now, period, tz);

    // Up to date: last_period_end is at or beyond the last completed period.
    if (compareISO(streak.lastPeriodEnd, lastCompletedEnd) >= 0) {
      summary.upToDate += 1;
      continue;
    }

    // Missed at least one period.
    if (streak.freezeTokens > 0) {
      await deps.data.persistFreezeSpend(streak.id, {
        freezeTokens: streak.freezeTokens - 1,
        lastPeriodEnd: lastCompletedEnd,
      });
      summary.frozen += 1;
      await deps.notifier.notify({
        userId: streak.userId,
        type: "freeze_token_applied",
        title: "Streak protected",
        message:
          "You missed a period, so a freeze token kept your streak alive.",
        data: {
          streakType: streak.streakType,
          streakId: streak.id,
          freezeTokensRemaining: streak.freezeTokens - 1,
        },
        relatedEntityId: streak.id,
      });
    } else {
      await deps.data.persistBreak(streak.id, {
        lastPeriodEnd: lastCompletedEnd,
      });
      summary.broken += 1;
    }
  }

  return summary;
}
