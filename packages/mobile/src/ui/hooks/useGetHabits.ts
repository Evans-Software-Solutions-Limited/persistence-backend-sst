import { useMemo } from "react";
import type { Habit, HabitCompletion } from "@/domain/models/habit-completion";
import { localDayISO, weekStartMondayISO } from "@/shared/utils";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

export type HabitsState = CachedResourceState<HabitCompletion[]> & {
  /** Derived Mon→Sun grid (matches HomeContainer's weekDates); container maps
   *  label/tone from goals. */
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

/** Build the Mon→Sun boolean grid per goal (aligns with the grid header). */
export function buildHabitGrid(
  completions: readonly HabitCompletion[],
  today: Date,
): Habit[] {
  // Fixed Mon→Sun week of the device-local "today" (NOT a rolling today-last
  // window), so days[i] lines up with HomeContainer's Mon→Sun weekDates[i].
  // Completions bucket via dayISO(completedAt), which equals the local day
  // because each completedAt is anchored at noon-UTC of its local day.
  const monday = weekStartMondayISO(localDayISO(today));
  const window: string[] = [];
  for (let i = 0; i < 7; i += 1) window.push(addDays(monday, i));

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
      const since = weekStartMondayISO(localDayISO());
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
