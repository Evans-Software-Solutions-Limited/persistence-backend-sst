import { useEffect, useMemo, useState } from "react";
import type {
  Habit,
  HabitCompletion,
  HabitTileTone,
} from "@/domain/models/habit-completion";
import type { HabitConfigEntry } from "@/domain/ports/api.port";
import {
  HABIT_CATEGORY_META,
  isHabitCategory,
} from "@/domain/models/habit-config";
import { localDayISO, weekStartMondayISO } from "@/shared/utils";
import { useAdapters } from "@/ui/hooks/useAdapters";
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

/** Build the per-goal boolean grid over the supplied Mon→Sun ISO window.
 *  Now config-aware: shows ALL enabled habits even when no completions exist. */
export function buildHabitGrid(
  completions: readonly HabitCompletion[],
  weekDates: readonly string[],
  configs?: readonly HabitConfigEntry[],
): Habit[] {
  const byGoal = new Map<string, Set<string>>();
  for (const c of completions) {
    const set = byGoal.get(c.goalId) ?? new Set<string>();
    set.add(c.localCompletedDate ?? dayISO(c.completedAt));
    byGoal.set(c.goalId, set);
  }

  // If we have configs, build from those (so all enabled habits appear). Label
  // + tone come from the canonical category metadata (T-18.7.6) — the prototype
  // tones (water=primary, gym=ember, steps=trainer, sleep=success,
  // calories=gold), replacing the earlier placeholder map that mis-toned the
  // grid (gym=success, steps=gold, sleep=primary, calories=ember).
  if (configs && configs.length > 0) {
    return configs
      .filter((c) => c.enabled && c.goalId)
      .map((cfg) => {
        const completionDays = byGoal.get(cfg.goalId!) ?? new Set<string>();
        const meta = isHabitCategory(cfg.category)
          ? HABIT_CATEGORY_META[cfg.category]
          : null;
        return {
          id: cfg.goalId!,
          label: meta?.name ?? cfg.category,
          tone: (meta?.tone ?? "primary") as HabitTileTone,
          days: weekDates.map((d) => completionDays.has(d)),
        };
      });
  }

  // Fallback: build from completions alone (legacy path)
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
 *
 * Now also fetches habit configs so the grid shows all enabled habits
 * even when no completions have been logged this week.
 */
export function useGetHabits(): HabitsState {
  const { api } = useAdapters();
  const [configs, setConfigs] = useState<HabitConfigEntry[]>([]);

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

  // Fetch habit configs (fire-and-forget; non-blocking)
  useEffect(() => {
    api.getHabitConfigs().then((result) => {
      if (result.ok) {
        setConfigs(result.value);
      }
    });
  }, [api]);

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
    () => buildHabitGrid(res.data ?? [], weekDates, configs),
    [res.data, weekDates, configs],
  );
  return { ...res, habits, weekDates };
}
