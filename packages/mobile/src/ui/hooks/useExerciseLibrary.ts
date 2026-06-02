import { create } from "zustand";

/**
 * useExerciseLibrary — a one-field signal store for "the local exercise
 * library changed" events.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-006 AC 6.5
 *
 * The Create-Exercise sheet (mounted in <TrainHubContainer>) and the exercise
 * list (<ExerciseListContainer>) are sibling containers — a write in one can't
 * reach the other's local `cacheVersion`. The command writes the new custom
 * exercise straight into the same `cached_exercises` store the list reads, but
 * the list won't re-read until something invalidates its memo. On a successful
 * create the sheet bumps `revision`; the list folds `revision` into its cache
 * read so the new exercise surfaces under the "Mine" filter immediately,
 * without an app reload or a network round-trip.
 *
 * Kept as a tiny dedicated store (not folded into `useTrainSegment`, which is
 * owned by 14-navigation) so ownership stays with this spec.
 */
export interface ExerciseLibraryState {
  /** Increments on every local exercise mutation that the list should pick up. */
  revision: number;
  /** Signal that the local exercise library changed (create/edit/delete). */
  markChanged: () => void;
}

export const useExerciseLibrary = create<ExerciseLibraryState>((set) => ({
  revision: 0,
  markChanged: () => set((s) => ({ revision: s.revision + 1 })),
}));
