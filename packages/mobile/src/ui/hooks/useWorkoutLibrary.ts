import { create } from "zustand";

/**
 * useWorkoutLibrary — a one-field signal store for "the local workout library
 * changed" events. The exact shape of `useExerciseLibrary`, which existed
 * because exercises hit this problem first.
 *
 * `useWorkouts` is a plain hook holding its own `useState`, and it has TWO
 * independent consumers — `HomeContainer` (the Today carousel) and
 * `WorkoutsListContainer` (Train > Workouts). Each holds a separate snapshot and
 * a separate `cacheVersion`, so `rereadCache()` on Train could not reach Home's
 * copy and vice versa: create a workout, go to Home, and the carousel still
 * showed the pre-create list until its own network refresh landed.
 *
 * Bumping `revision` wakes every consumer at once.
 *
 * Why keep this alongside `StoragePort.subscribe`, which observes the same
 * writes automatically? Two reasons, both deliberate:
 *   1. The change bus depends on a native update hook. Its attach path is
 *      wrapped and degrades to a warning if the event is unavailable, so an
 *      explicit signal keeps cross-screen invalidation working in that case.
 *   2. A signal can express "re-read even though nothing was written" — a
 *      discarded queue entry, a retry, a filter change — which a write-driven
 *      bus by definition cannot.
 */
export interface WorkoutLibraryState {
  /** Increments on every local workout mutation consumers should pick up. */
  revision: number;
  /** Signal that the local workout library changed (create/edit/delete). */
  markChanged: () => void;
}

export const useWorkoutLibrary = create<WorkoutLibraryState>((set) => ({
  revision: 0,
  markChanged: () => set((s) => ({ revision: s.revision + 1 })),
}));
