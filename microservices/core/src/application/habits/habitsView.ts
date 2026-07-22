/**
 * Build the 7-day Home habits grid (06-progress-goals, Phase 06.5; STORY-004)
 * from raw habit_completions rows.
 *
 * Buckets each completion by its STORED `local_completed_date` — the day the
 * writer fixed from the user's timezone at insert time and the same key the
 * dedup index + streak engine use. Re-deriving the day from `completed_at`
 * with the CURRENT profile timezone desyncs the grid from the dedup key after
 * a timezone change, producing stuck toggles (Inspector finding, PR #116).
 *
 * `days` is length-7 with TODAY last (per design.md § HabitsGridProps).
 */

import { localDateISO, addDaysISO } from "../streaks/period";

export interface HabitGridRow {
  goalId: string;
  days: boolean[]; // length 7, today last
}

export interface CompletionLike {
  goalId: string;
  localCompletedDate: string; // YYYY-MM-DD, authoritative user-local day
}

/**
 * The habits-grid window — [today-6 … today], today last (design.md §
 * HabitsGridProps). Exported so callers that need to derive PER-DAY rows
 * outside `habit_completions` (Gym/Calories — see
 * StreakRepository.getDerivedHabitGridRows, BRIEF-7 QA-1..QA-4) compute
 * against the identical window this grid uses, rather than re-deriving it and
 * risking drift.
 */
export function habitsGridWindow(now: Date, tz: string): string[] {
  const today = localDateISO(now, tz);
  const window: string[] = [];
  for (let i = 6; i >= 0; i -= 1) window.push(addDaysISO(today, -i));
  return window;
}

export function buildHabitsGrid(
  completions: CompletionLike[],
  now: Date,
  tz: string,
): HabitGridRow[] {
  const window = habitsGridWindow(now, tz);

  const byGoal = new Map<string, Set<string>>();
  for (const c of completions) {
    const set = byGoal.get(c.goalId) ?? new Set<string>();
    set.add(c.localCompletedDate);
    byGoal.set(c.goalId, set);
  }

  return [...byGoal.entries()].map(([goalId, days]) => ({
    goalId,
    days: window.map((d) => days.has(d)),
  }));
}

/**
 * Merge DERIVED per-day rows (Gym/Calories, computed straight from logged
 * `workout_sessions`/`nutrition_entries` — see
 * StreakRepository.getDerivedHabitGridRows) into the completion-based grid
 * `buildHabitsGrid` produces (BRIEF-7 QA-1..QA-4). Derived rows WIN per
 * `goalId`: Gym/Calories never write a `habit_completions` row, so there's no
 * real collision, but a derived row is authoritative if one is ever present.
 * Every other category (Water/Steps/Sleep) passes through unchanged, exactly
 * as `buildHabitsGrid` already renders it.
 */
export function mergeDerivedHabitRows(
  base: HabitGridRow[],
  derived: HabitGridRow[],
): HabitGridRow[] {
  const derivedGoalIds = new Set(derived.map((r) => r.goalId));
  const passthrough = base.filter((r) => !derivedGoalIds.has(r.goalId));
  return [...passthrough, ...derived];
}
