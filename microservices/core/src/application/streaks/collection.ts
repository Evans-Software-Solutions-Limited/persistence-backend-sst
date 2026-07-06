/**
 * Collection habit-streak satisfaction (18-habit-setup, Phase 18.5 —
 * T-18.5.1 / T-18.5.2). Per design.md § 4.1 + § 4.2 and cross-cuts § 3.7.
 *
 * The habit streak is ONE weekly collection row (`streak_type='habit_streak'`,
 * `source_goal_id=NULL`, `period='weekly'`). A week counts toward it when EVERY
 * enabled habit's weekly target is met (`isPeriodSatisfied` for the collection
 * row). This module holds the PURE decision — "does this habit's week aggregate
 * clear its bar?" and "are all enabled habits met?" — so it is unit-testable
 * without a DB; the SQL that produces the aggregates lives in StreakRepository.
 *
 * Anti-gaming (design.md § 4.4 / locked decision 12): each habit is scored
 * against the config that was EFFECTIVE at the week's Monday — the repository
 * only feeds this module habits whose `effective_from <= weekStart`, so a fresh
 * enable (future `effective_from`) is loggable but not yet part of the
 * collection requirement.
 */

import type { HabitCompletionRule } from "../habits/habitCategories";

/**
 * A habit's config as it applies to one scored week, plus the aggregates the
 * repository computed for that week. Everything here is already resolved to the
 * week-start config (the repository applies the `effective_from` gate).
 */
export interface HabitWeekAggregate {
  goalId: string;
  completionRule: HabitCompletionRule;
  /** Litres / steps / hours / kcal / sessions-per-week target. */
  targetValue: number;
  /** 1..7 for daily habits; null for Gym (weekly count). */
  daysPerWeek: number | null;
  /** Calories leniency (± %); null otherwise. */
  tolerancePct: number | null;
  /**
   * For `value_gte`: the number of DAYS in the week whose summed value
   * `>= targetValue`. For `within_tolerance`: the number of DAYS whose kcal
   * total fell within `target ± tolerance_pct%`. Ignored for `count`.
   */
  qualifyingDays: number;
  /** For `count` (Gym): qualifying workout_sessions in the week. */
  sessionCount: number;
}

/**
 * Whether a single habit's WEEK is met (design.md § 4.1):
 *  - `value_gte` (Water/Steps/Sleep): met when qualifying days `>= days_per_week`.
 *  - `within_tolerance` (Calories): same, over in-tolerance days. M9 has shipped
 *    (nutrition_entries is live), so this is evaluated FOR REAL — the repository
 *    feeds `qualifyingDays` from the daily kcal totals.
 *  - `count` (Gym): met when logged sessions `>= target_value`.
 */
export function weekMet(habit: HabitWeekAggregate): boolean {
  switch (habit.completionRule) {
    case "count":
      return habit.sessionCount >= Math.ceil(habit.targetValue);
    case "value_gte":
    case "within_tolerance": {
      // A daily habit always carries a days_per_week (server-validated); guard
      // with 1 so a malformed row can't be trivially "met" on zero days.
      const need = habit.daysPerWeek ?? 1;
      return habit.qualifyingDays >= need;
    }
  }
}

/**
 * The collection week is satisfied when there is at least one enabled habit AND
 * every enabled habit's week is met (design.md § 4.2 / STORY-003 AC 3.2). An
 * empty set (no enabled habits effective this week) is NOT satisfied — there is
 * nothing to streak, so the week can't advance the collection count.
 */
export function collectionSatisfied(habits: HabitWeekAggregate[]): boolean {
  if (habits.length === 0) return false;
  return habits.every(weekMet);
}

/**
 * Whether the collection is AT RISK mid-week (design.md § 4.2, the prototype's
 * at-risk banner): with `remainingDays` days left in the current Mon–Sun week
 * (today inclusive counts as remaining), some enabled habit can no longer reach
 * its target even if every remaining day qualifies. Best-case each remaining
 * day adds one qualifying day (value_gte / within_tolerance) or one session
 * (count), so a habit is doomed when `progress + remainingDays < need`.
 *
 * Returns false when there are no enabled habits (nothing to be at risk over)
 * or when the collection is already satisfied.
 */
export function collectionAtRisk(
  habits: HabitWeekAggregate[],
  remainingDays: number,
): boolean {
  if (habits.length === 0) return false;
  if (collectionSatisfied(habits)) return false;
  return habits.some((h) => {
    if (h.completionRule === "count") {
      return h.sessionCount + remainingDays < Math.ceil(h.targetValue);
    }
    const need = h.daysPerWeek ?? 1;
    return h.qualifyingDays + remainingDays < need;
  });
}
