import { useMemo } from "react";
import type { Habit, HabitCompletion } from "@/domain/models/habit-completion";
import { localDayISO, weekStartMondayISO } from "@/shared/utils";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

export type HabitsState = CachedResourceState<HabitCompletion[]> & {
  /** Derived Mon→Sun grid; container maps label/tone from goals. */
  habits: Habit[];
  /** The Mon→Sun ISO window habits[*].days[i] is indexed against. Consumed by
   *  the grid header so the two halves share one source and can never drift
   *  apart (e.g. across a midnight refresh). */
  weekDates: string[];
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

/** Build the per-goal boolean grid over the supplied Mon→Sun ISO window. */
export function buildHabitGrid(
  completions: readonly HabitCompletion[],
  weekDates: readonly string[],
): Habit[] {
  // `weekDates` is the shared Mon→Sun window (NOT a rolling today-last one), so
  // days[i] lines up verbatim with the grid header's weekDates[i]. Completions
  // bucket via dayISO(completedAt), which equals the local day because each
  // completedAt is anchored at noon-UTC of its local day.
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
    days: weekDates.map((d) => days.has(d)),
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

  // The Mon→Sun ISO window, recomputed only when the device-local day actually
  // changes (todayISO is a primitive, so ordinary re-renders are stable). Both
  // `weekDates` and `habits` derive from it, so the grid header and the
  // completion columns are always built from the same week — they can't drift
  // apart, including across a midnight refresh or a Home→You→Home round trip.
  const todayISO = localDayISO();
  const weekDates = useMemo(() => {
    const monday = weekStartMondayISO(todayISO);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [todayISO]);

  const habits = useMemo(
    () => buildHabitGrid(res.data ?? [], weekDates),
    [res.data, weekDates],
  );
  return { ...res, habits, weekDates };
}
