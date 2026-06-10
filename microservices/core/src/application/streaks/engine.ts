/**
 * Streak engine (06-progress-goals, Phase 06.2). Per cross-cuts § 3.
 *
 * `evaluateStreaks` runs on-write — every event that could satisfy a streak
 * (a workout logged, a habit completed, a measurement recorded) calls it. It
 * advances any matching active streak whose current user-local period has just
 * been satisfied, earns freeze tokens, unlocks milestone achievements, and
 * emits `streak_milestone` notifications.
 *
 * The "nothing happened" case (a period elapses with no event) is the nightly
 * cron's job (cron.ts) — the on-write hook can't fire on the absence of an
 * event.
 *
 * Data access + notification delivery are injected ports so the orchestration
 * is unit-testable without a DB. The real wiring lives in
 * repositories/streakRepository.ts + the streakCron handler.
 */

import type { UserStreak } from "@persistence/db";
import {
  periodEndISO,
  periodStartFromEndISO,
  previousPeriodEndISO,
  periodsBetween,
  compareISO,
  type Period,
} from "./period";
import { crossedMilestones, freezeTokensAfterAdvance } from "./milestones";

export type StreakEventType =
  | "workout_logged"
  | "habit_completed"
  | "measurement_logged"
  | "nutrition_in_target";

export type StreakType =
  | "workout_streak"
  | "habit_streak"
  | "measurement_streak"
  | "nutrition_streak";

/** Which streak type an event feeds. */
export const EVENT_TO_STREAK_TYPE: Record<StreakEventType, StreakType> = {
  workout_logged: "workout_streak",
  habit_completed: "habit_streak",
  measurement_logged: "measurement_streak",
  nutrition_in_target: "nutrition_streak",
};

/** A milestone that was newly unlocked by an advance. */
export interface UnlockedMilestone {
  streakId: string;
  streakType: StreakType;
  threshold: number;
  achievementId: string;
}

/** Fields persisted when a streak advances one period. */
export interface StreakAdvanceFields {
  currentCount: number;
  longestCount: number;
  lastPeriodEnd: string;
  freezeTokens: number;
}

/**
 * Data port — the engine asks these of the DB layer. Implemented by
 * StreakRepository; faked in tests.
 */
export interface StreakDataPort {
  getUserTimezone(userId: string): Promise<string>;
  getActiveStreaksByType(
    userId: string,
    streakType: StreakType,
  ): Promise<UserStreak[]>;
  /**
   * Whether `streak`'s threshold was met within the user-local date window
   * [startDate, endDate] (inclusive). The repository pushes the tz conversion
   * into SQL (`AT TIME ZONE`). For workout_streak the threshold is the source
   * goal's target_value (≥ N sessions); for habit/measurement/nutrition it is
   * "≥ 1 qualifying row".
   */
  isPeriodSatisfied(
    streak: UserStreak,
    startDate: string,
    endDate: string,
    tz: string,
  ): Promise<boolean>;
  persistAdvance(
    streakId: string,
    fields: StreakAdvanceFields,
  ): Promise<UserStreak>;
  /**
   * Resolve the achievement for (streakType, threshold) and insert a
   * user_achievements row idempotently. Returns the achievementId +
   * whether it was newly unlocked (false on a duplicate), or null when no
   * matching achievement is seeded.
   */
  unlockAchievement(
    userId: string,
    streakType: StreakType,
    threshold: number,
  ): Promise<{ achievementId: string; newlyUnlocked: boolean } | null>;
}

export interface StreakNotification {
  userId: string;
  type: "streak_milestone" | "streak_at_risk" | "freeze_token_applied";
  title: string;
  message: string;
  data: Record<string, unknown>;
  relatedEntityId: string | null;
}

export interface StreakNotifier {
  notify(notification: StreakNotification): Promise<void>;
}

export interface StreakEngineDeps {
  data: StreakDataPort;
  notifier: StreakNotifier;
}

export interface EvaluateResult {
  advanced: UserStreak[];
  milestones: UnlockedMilestone[];
}

/**
 * Advance a single streak if its current period has just been satisfied.
 * Returns the updated row + any milestones, or null if no advance happened
 * (period already counted, or threshold not yet met). Shared shape so the
 * milestone-emit path is identical across callers.
 */
async function tryAdvance(
  streak: UserStreak,
  ts: Date,
  tz: string,
  deps: StreakEngineDeps,
): Promise<{ updated: UserStreak; milestones: UnlockedMilestone[] } | null> {
  const period = streak.period as Period;
  const currentEnd = periodEndISO(ts, period, tz);

  // Already advanced for this (or a later) period — idempotent no-op. Also
  // guards against an event arriving for a period at/behind last_period_end.
  if (compareISO(currentEnd, streak.lastPeriodEnd) <= 0) return null;

  const currentStart = periodStartFromEndISO(currentEnd, period);
  const satisfied = await deps.data.isPeriodSatisfied(
    streak,
    currentStart,
    currentEnd,
    tz,
  );
  if (!satisfied) return null;

  // Missed periods strictly between last_period_end and the period being
  // advanced. An on-write event can land AFTER a missed period but BEFORE the
  // nightly cron sweeps it (any user east of UTC logging before the 02:00 UTC
  // cron) — without this the advance would silently coalesce the gap into a
  // single +1 and the cron would then see the streak as up to date, bypassing
  // the freeze-token mechanic entirely (Inspector finding, PR #116). Same
  // 1-token-per-missed-period rule as the cron (cross-cuts § 3.5).
  //
  // A `broken` streak (cron already zeroed it) skips the gap maths entirely —
  // there is no count left to protect, so spending tokens would be waste. The
  // satisfied current period simply RESTARTS it at 1 (persistAdvance flips
  // status back to 'active'); same restart when an active streak's gap exceeds
  // its token balance: the streak breaks per § 3.5, but today's satisfied
  // period immediately seeds the new streak rather than being discarded into
  // a dead row (Inspector finding — broken was otherwise terminal).
  const wasBroken = streak.status === "broken";
  const previousEnd = previousPeriodEndISO(currentEnd, period);
  const missed = wasBroken
    ? 0
    : periodsBetween(streak.lastPeriodEnd, previousEnd, period);
  let tokensAfterGap = streak.freezeTokens;
  let restart = wasBroken;
  if (missed > 0) {
    if (streak.freezeTokens < missed) {
      // Gap can't be covered — streak breaks, restarting at 1 from today.
      // Tokens are kept (the cron's break doesn't drain them either).
      restart = true;
    } else {
      tokensAfterGap = streak.freezeTokens - missed;
      await deps.notifier.notify({
        userId: streak.userId,
        type: "freeze_token_applied",
        title: "Streak protected",
        message:
          missed === 1
            ? "You missed a period, so a freeze token kept your streak alive."
            : `You missed ${missed} periods, so ${missed} freeze tokens kept your streak alive.`,
        data: {
          streakType: streak.streakType,
          streakId: streak.id,
          periodsMissed: missed,
          tokensSpent: missed,
          freezeTokensRemaining: tokensAfterGap,
        },
        relatedEntityId: streak.id,
      });
    }
  }

  const prevCount = restart ? 0 : streak.currentCount;
  const newCount = prevCount + 1;
  const fields: StreakAdvanceFields = {
    currentCount: newCount,
    longestCount: Math.max(streak.longestCount, newCount),
    lastPeriodEnd: currentEnd,
    freezeTokens: freezeTokensAfterAdvance(tokensAfterGap, newCount),
  };

  const updated = await deps.data.persistAdvance(streak.id, fields);

  const milestones: UnlockedMilestone[] = [];
  for (const threshold of crossedMilestones(prevCount, newCount, period)) {
    const unlocked = await deps.data.unlockAchievement(
      streak.userId,
      streak.streakType as StreakType,
      threshold,
    );
    if (unlocked && unlocked.newlyUnlocked) {
      milestones.push({
        streakId: streak.id,
        streakType: streak.streakType as StreakType,
        threshold,
        achievementId: unlocked.achievementId,
      });
      await deps.notifier.notify({
        userId: streak.userId,
        type: "streak_milestone",
        title: "Streak milestone!",
        message: milestoneMessage(streak.streakType as StreakType, threshold),
        data: {
          streakType: streak.streakType,
          threshold,
          streakId: streak.id,
          achievementId: unlocked.achievementId,
        },
        relatedEntityId: streak.id,
      });
    }
  }

  return { updated, milestones };
}

/** Human-readable milestone copy. Weekly streaks count weeks; daily count days. */
export function milestoneMessage(
  streakType: StreakType,
  threshold: number,
): string {
  const isWeekly =
    streakType === "workout_streak" || streakType === "measurement_streak";
  const unit = isWeekly ? (threshold === 1 ? "week" : "weeks") : "days";
  return `You hit a ${threshold}-${unit} streak. Keep it going!`;
}

/**
 * On-write entrypoint. For every active streak matching the event's type,
 * advance it if its current period just became satisfied.
 */
export async function evaluateStreaks(
  userId: string,
  eventType: StreakEventType,
  ts: Date,
  deps: StreakEngineDeps,
): Promise<EvaluateResult> {
  const streakType = EVENT_TO_STREAK_TYPE[eventType];
  const streaks = await deps.data.getActiveStreaksByType(userId, streakType);
  if (streaks.length === 0) return { advanced: [], milestones: [] };

  const tz = await deps.data.getUserTimezone(userId);

  const advanced: UserStreak[] = [];
  const milestones: UnlockedMilestone[] = [];
  for (const streak of streaks) {
    const result = await tryAdvance(streak, ts, tz, deps);
    if (result) {
      advanced.push(result.updated);
      milestones.push(...result.milestones);
    }
  }

  return { advanced, milestones };
}
