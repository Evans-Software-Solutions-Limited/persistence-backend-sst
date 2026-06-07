/**
 * Build the 7-day Home habits grid (06-progress-goals, Phase 06.5; STORY-004)
 * from raw habit_completions. Pure — buckets each completion into a user-local
 * day so the grid lines up with the user's calendar (cross-cuts § 3.4).
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
  completedAt: Date | string;
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
    const day = localDateISO(new Date(c.completedAt), tz);
    const set = byGoal.get(c.goalId) ?? new Set<string>();
    set.add(day);
    byGoal.set(c.goalId, set);
  }

  return [...byGoal.entries()].map(([goalId, days]) => ({
    goalId,
    days: window.map((d) => days.has(d)),
  }));
}
