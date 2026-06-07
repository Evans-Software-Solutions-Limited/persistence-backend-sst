import { useMemo } from "react";
import type { Habit, HabitCompletion } from "@/domain/models/habit-completion";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

export type HabitsState = CachedResourceState<HabitCompletion[]> & {
  /** Derived 7-day grid (today last); container maps label/tone from goals. */
  habits: Habit[];
};

function dayISO(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Build the 7-day boolean grid per goal (today last). */
export function buildHabitGrid(
  completions: readonly HabitCompletion[],
  today: Date,
): Habit[] {
  const todayKey = dayISO(today);
  const window: string[] = [];
  for (let i = 6; i >= 0; i -= 1) window.push(addDays(todayKey, -i));

  const byGoal = new Map<string, Set<string>>();
  for (const c of completions) {
    const set = byGoal.get(c.goalId) ?? new Set<string>();
    set.add(dayISO(c.completedAt));
    byGoal.set(c.goalId, set);
  }
  return [...byGoal.entries()].map(([goalId, days]) => ({
    id: goalId,
    label: goalId,
    tone: "primary" as const,
    days: window.map((d) => days.has(d)),
  }));
}

/**
 * Habit completions + derived 7-day grid for the Home HabitsGrid
 * (06-progress-goals, Phase 06.7; STORY-004). Cache-first from
 * `cached_habit_completions`; the toggle command writes optimistically there.
 */
export function useGetHabits(): HabitsState {
  const res = useCachedResource<HabitCompletion[]>({
    read: (storage, userId) => {
      const since = addDays(new Date().toISOString().slice(0, 10), -6);
      return {
        value: storage.getCachedHabitCompletions(userId, { since }),
        isStale: true,
      };
    },
    fetcher: (api) => api.getHabitCompletions({ window: "7d" }),
    write: (storage, userId, value) =>
      storage.cacheHabitCompletions(userId, value),
  });

  const habits = useMemo(
    () => buildHabitGrid(res.data ?? [], new Date()),
    [res.data],
  );
  return { ...res, habits };
}
