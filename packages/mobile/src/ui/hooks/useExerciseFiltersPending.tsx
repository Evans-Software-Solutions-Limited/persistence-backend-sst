import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  CreatedByFilter,
  ExerciseDifficulty,
} from "@/domain/models/exercise";
import { useExerciseFilters } from "./useExerciseFilters";

/**
 * Pending-state context for the hierarchical filter modal.
 *
 * The outer `ExerciseFiltersContext` (see `useExerciseFilters`) holds the
 * COMMITTED filter state that drives the list. This context holds the
 * UNCOMMITTED edits the user is making inside the modal — copied from
 * the committed state on mount, mutated across axis screens, and
 * flushed back to the committed state on Apply (or discarded on close).
 *
 * Scoping: provider is mounted in `app/(app)/exercises/filters/_layout.tsx`.
 * All four axis screens + the section index read/write via this hook.
 * When the modal dismisses, the provider unmounts and pending state is
 * gone — matching the modal lifecycle.
 *
 * Spec: specs/03-exercise-library/design.md § Hierarchical Filter Modal
 *       · requirements.md AC 7.11, AC 7.12
 */

type PendingState = {
  /** Muscle-group UUIDs — the filter modal populates from the DB catalogue. */
  muscleGroups: string[];
  /** Equipment UUIDs — same rationale. */
  equipment: string[];
  difficulties: ExerciseDifficulty[];
  createdBy: CreatedByFilter | null;
};

export type ExerciseFiltersPendingContextValue = PendingState & {
  toggleMuscleGroup: (key: string) => void;
  toggleEquipment: (key: string) => void;
  toggleDifficulty: (key: ExerciseDifficulty) => void;
  /**
   * `createdBy` is a radio (mine XOR system). Passing the already-selected
   * value clears it; passing a different value swaps.
   */
  selectCreatedBy: (value: CreatedByFilter | null) => void;
  clearAll: () => void;
  /** Number of selections across all four axes, for "N selected" subtitles. */
  selectionCounts: {
    muscleGroups: number;
    equipment: number;
    difficulties: number;
    createdBy: number;
  };
};

const Context = createContext<ExerciseFiltersPendingContextValue | null>(null);

export function useExerciseFiltersPending(): ExerciseFiltersPendingContextValue {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error(
      "useExerciseFiltersPending must be used within ExerciseFiltersPendingProvider",
    );
  }
  return ctx;
}

export function ExerciseFiltersPendingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const applied = useExerciseFilters();

  // Seed from the committed state ONCE on mount. After that the pending
  // state evolves independently; re-seeding on every render would wipe
  // user edits whenever the outer context shifted for any reason.
  const [state, setState] = useState<PendingState>(() => ({
    muscleGroups: [...applied.muscleGroups],
    equipment: [...applied.equipment],
    difficulties: [...applied.difficultiesAdvanced],
    createdBy:
      applied.quickFilters.find(
        (q): q is CreatedByFilter => q === "mine" || q === "system",
      ) ?? null,
  }));

  const toggleMuscleGroup = useCallback((key: string) => {
    setState((prev) => ({
      ...prev,
      muscleGroups: prev.muscleGroups.includes(key)
        ? prev.muscleGroups.filter((k) => k !== key)
        : [...prev.muscleGroups, key],
    }));
  }, []);

  const toggleEquipment = useCallback((key: string) => {
    setState((prev) => ({
      ...prev,
      equipment: prev.equipment.includes(key)
        ? prev.equipment.filter((k) => k !== key)
        : [...prev.equipment, key],
    }));
  }, []);

  const toggleDifficulty = useCallback((key: ExerciseDifficulty) => {
    setState((prev) => ({
      ...prev,
      difficulties: prev.difficulties.includes(key)
        ? prev.difficulties.filter((k) => k !== key)
        : [...prev.difficulties, key],
    }));
  }, []);

  const selectCreatedBy = useCallback((value: CreatedByFilter | null) => {
    setState((prev) => ({
      ...prev,
      // Tapping the currently-selected value clears it (radio toggle).
      createdBy: prev.createdBy === value ? null : value,
    }));
  }, []);

  const clearAll = useCallback(() => {
    setState({
      muscleGroups: [],
      equipment: [],
      difficulties: [],
      createdBy: null,
    });
  }, []);

  const value = useMemo<ExerciseFiltersPendingContextValue>(
    () => ({
      ...state,
      toggleMuscleGroup,
      toggleEquipment,
      toggleDifficulty,
      selectCreatedBy,
      clearAll,
      selectionCounts: {
        muscleGroups: state.muscleGroups.length,
        equipment: state.equipment.length,
        difficulties: state.difficulties.length,
        createdBy: state.createdBy === null ? 0 : 1,
      },
    }),
    [
      state,
      toggleMuscleGroup,
      toggleEquipment,
      toggleDifficulty,
      selectCreatedBy,
      clearAll,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
