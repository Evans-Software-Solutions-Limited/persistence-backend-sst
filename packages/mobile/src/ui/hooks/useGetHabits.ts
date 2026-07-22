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
    return (
      configs
        // Filter on the LIVE `enabled` — which is exactly "counts toward the
        // streak THIS week". A disable is deferred to next Monday (live stays
        // enabled + a pending `{enabled:false}`), so the habit keeps scoring
        // this week and MUST stay on the grid so the user can still hit it;
        // dropping it on the pending intent would strand a habit that still
        // counts (guaranteed miss). It drops on Monday when the disable goes
        // live. Symmetrically, a pending ENABLE (live off) is correctly hidden
        // until it starts counting Monday. The setup screen shows the intended
        // (off) switch + the "starts Monday" banner; the grid shows what's live.
        .filter((c) => c.enabled && c.goalId)
        .map((cfg) => {
          const completionDays = byGoal.get(cfg.goalId!) ?? new Set<string>();
          const meta = isHabitCategory(cfg.category)
            ? HABIT_CATEGORY_META[cfg.category]
            : null;
          // Regression fix: a grid tap POSTs a habit_completion whose `value`
          // must satisfy the backend's per-category validateCompletionValue —
          // threading the config's live targetValue through lets the toggle
          // command send it (a tap means "I met my target today"). Gated on
          // `completionRule === "value_gte"` (water/steps/sleep), the actual
          // server-side signal for "requires a value" — NOT the category name.
          // Gym (`count`) never requires a value: threading its target anyway
          // would send an inert `value` the server drops and the engine
          // ignores, contradicting the intended byte-identical-to-legacy wire
          // shape, so it stays targetValue=null (toggleable, no value key at
          // all). Calories is excluded entirely: the engine scores it from
          // nutrition_entries, so a habit_completions row there is meaningless
          // — the tile is read-only and deep-links to Fuel instead of toggling.
          const isCalories = cfg.category === "calories";
          const requiresValue = cfg.completionRule === "value_gte";
          return {
            id: cfg.goalId!,
            label: meta?.name ?? cfg.category,
            tone: (meta?.tone ?? "primary") as HabitTileTone,
            days: weekDates.map((d) => completionDays.has(d)),
            targetValue: requiresValue ? cfg.targetValue : null,
            toggleable: !isCalories,
          };
        })
    );
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
 *
 * BRIEF-7 QA-1..QA-4 (mobile half): fetches with `includeDerived: true` so
 * the Gym/Calories tiles — which never write a real `habit_completions` row —
 * tick from the backend's synthetic `derived-<goalId>-<date>` rows the same
 * way a real completion would (`buildHabitGrid` buckets by goalId + date
 * either way). Those synthetic rows are READ-ONLY: `cacheDerivedFiltered`
 * strips any `derived-`-id row before it reaches `cacheHabitCompletions`, so
 * they NEVER land in the offline SQLite cache and therefore can never be
 * picked up by anything that scans it (there is no such scan today, but this
 * guarantees one could never accidentally start syncing a synthetic row).
 * The toggle-habit mutation path (`setHabitCompletion`) is separately safe by
 * construction — a grid tap calls it with `{goalId, day, done}`, never a
 * completion's own `id`, so a derived row's id is never even read on that
 * path.
 */
function stripDerivedRows(rows: HabitCompletion[]): HabitCompletion[] {
  return rows.filter((r) => !r.id.startsWith("derived-"));
}

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
    fetcher: (api) =>
      api.getHabitCompletions({ window: "7d", includeDerived: true }),
    // Only REAL completions get persisted to the offline cache — derived
    // rows are recomputed server-side every request and must never be
    // written locally (see the READ-ONLY note above).
    write: (storage, userId, value) =>
      storage.cacheHabitCompletions(userId, stripDerivedRows(value)),
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
