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

export function buildHabitsGrid(
  completions: CompletionLike[],
  now: Date,
  tz: string,
): HabitGridRow[] {
  const today = localDateISO(now, tz);
  // [today-6 … today]
  const window: string[] = [];
  for (let i = 6; i >= 0; i -= 1) window.push(addDaysISO(today, -i));

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
