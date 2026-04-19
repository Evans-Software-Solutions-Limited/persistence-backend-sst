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
  EquipmentType,
  ExerciseDifficulty,
  ExerciseFilters,
  MuscleGroup,
} from "@/domain/models/exercise";
import type { QuickFilterId } from "@/ui/components/ExerciseFilterBar";

/**
 * Shared filter state for the exercises feature. Lives above both the list
 * screen (inside `(tabs)`) and the advanced filter modal (a sibling route
 * of the tabs). Having a single source of truth avoids serialising complex
 * filter state through navigation params and keeps the modal's changes
 * visible to the list without manual prop-threading.
 *
 * Quick-filter semantics match the legacy app:
 *   - `"all"` is mutually exclusive with every other pill.
 *   - Selecting any non-`all` pill deselects `"all"`.
 *   - Deselecting the last non-`all` pill falls back to `["all"]`.
 *   - `"mine"` / `"system"` live on the `createdBy` axis; multi-select is
 *     not meaningful there (they're opposites), so toggling one clears the
 *     other. Picking neither means "any creator".
 *   - Difficulty pills OR together inside the `difficulties` axis.
 */

type State = {
  quickFilters: QuickFilterId[];
  muscleGroups: MuscleGroup[];
  equipment: EquipmentType[];
  difficultiesAdvanced: ExerciseDifficulty[];
  search: string;
};

const CREATED_BY_IDS: readonly QuickFilterId[] = ["mine", "system"] as const;
const DIFFICULTY_IDS: readonly QuickFilterId[] = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
] as const;

function isCreatedBy(id: QuickFilterId): id is CreatedByFilter {
  return CREATED_BY_IDS.includes(id);
}

function isDifficulty(id: QuickFilterId): id is ExerciseDifficulty {
  return DIFFICULTY_IDS.includes(id);
}

const INITIAL_STATE: State = {
  quickFilters: ["all"],
  muscleGroups: [],
  equipment: [],
  difficultiesAdvanced: [],
  search: "",
};

export type ExerciseFiltersContextValue = {
  // --- raw state ---
  quickFilters: QuickFilterId[];
  muscleGroups: MuscleGroup[];
  equipment: EquipmentType[];
  difficultiesAdvanced: ExerciseDifficulty[];
  search: string;

  // --- derived flags ---
  /** True iff any muscle/equipment/difficulty filter (from the modal) is set. */
  hasAdvancedFilters: boolean;
  /** True iff anything but `"all"` + empty modal state is selected. */
  hasAnyFilter: boolean;

  // --- derived query filters ---
  /** The `ExerciseFilters` shape to pass to `getExercisesQuery`. */
  filters: ExerciseFilters;

  // --- actions ---
  toggleQuickFilter: (id: QuickFilterId) => void;
  setSearch: (text: string) => void;
  applyAdvanced: (next: {
    muscleGroups: MuscleGroup[];
    equipment: EquipmentType[];
    difficulties: ExerciseDifficulty[];
  }) => void;
  clearAll: () => void;
};

const ExerciseFiltersContext =
  createContext<ExerciseFiltersContextValue | null>(null);

export function useExerciseFilters(): ExerciseFiltersContextValue {
  const ctx = useContext(ExerciseFiltersContext);
  if (!ctx) {
    throw new Error(
      "useExerciseFilters must be used within an ExerciseFiltersProvider",
    );
  }
  return ctx;
}

/**
 * Deselect a quick-filter pill on the `createdBy` axis from a list.
 * Returns the remainder plus any non-creator pills, preserving order.
 */
function stripCreatedBy(pills: QuickFilterId[]): QuickFilterId[] {
  return pills.filter((p) => !isCreatedBy(p));
}

/**
 * Toggle a single quick-filter id into the selected list, applying the
 * legacy app's mutual-exclusivity rules.
 *
 * Exported for direct unit testing; `toggleQuickFilter` on the context
 * value is a thin wrapper around this.
 */
export function nextQuickFilters(
  current: QuickFilterId[],
  id: QuickFilterId,
): QuickFilterId[] {
  if (id === "all") {
    // "All" is always exclusive; tapping it clears everything else.
    return ["all"];
  }

  const withoutAll = current.filter((p) => p !== "all");

  if (isCreatedBy(id)) {
    // Selecting a createdBy pill removes the opposite createdBy pill
    // (they're mutually exclusive), and toggles this one.
    const withoutCreatedBy = stripCreatedBy(withoutAll);
    const wasSelected = withoutAll.includes(id);
    const next = wasSelected ? withoutCreatedBy : [...withoutCreatedBy, id];
    return next.length === 0 ? ["all"] : next;
  }

  if (isDifficulty(id)) {
    const wasSelected = withoutAll.includes(id);
    const next = wasSelected
      ? withoutAll.filter((p) => p !== id)
      : [...withoutAll, id];
    return next.length === 0 ? ["all"] : next;
  }

  // Unreachable given the QuickFilterId union, but keep graceful.
  return withoutAll.length === 0 ? ["all"] : withoutAll;
}

export function ExerciseFiltersProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(INITIAL_STATE);

  const toggleQuickFilter = useCallback((id: QuickFilterId) => {
    setState((prev) => ({
      ...prev,
      quickFilters: nextQuickFilters(prev.quickFilters, id),
    }));
  }, []);

  const setSearch = useCallback((text: string) => {
    setState((prev) => ({ ...prev, search: text }));
  }, []);

  const applyAdvanced = useCallback(
    (next: {
      muscleGroups: MuscleGroup[];
      equipment: EquipmentType[];
      difficulties: ExerciseDifficulty[];
    }) => {
      setState((prev) => ({
        ...prev,
        muscleGroups: next.muscleGroups,
        equipment: next.equipment,
        difficultiesAdvanced: next.difficulties,
      }));
    },
    [],
  );

  const clearAll = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const value = useMemo<ExerciseFiltersContextValue>(() => {
    const {
      quickFilters,
      muscleGroups,
      equipment,
      difficultiesAdvanced,
      search,
    } = state;

    const quickCreatedBy = quickFilters.find(isCreatedBy) ?? null;
    const quickDifficulties = quickFilters.filter(isDifficulty);

    // Advanced (modal) difficulties and quick-filter difficulties union.
    // Deduplicated to keep the query payload stable.
    const mergedDifficultySet = new Set<ExerciseDifficulty>([
      ...quickDifficulties,
      ...difficultiesAdvanced,
    ]);

    const filters: ExerciseFilters = {};
    const trimmedSearch = search.trim();
    if (trimmedSearch.length > 0) filters.search = trimmedSearch;
    if (muscleGroups.length > 0) filters.muscleGroups = muscleGroups;
    if (equipment.length > 0) filters.equipment = equipment;
    if (mergedDifficultySet.size > 0) {
      filters.difficulties = Array.from(mergedDifficultySet);
    }
    if (quickCreatedBy !== null) filters.createdBy = quickCreatedBy;

    const hasAdvancedFilters =
      muscleGroups.length > 0 ||
      equipment.length > 0 ||
      difficultiesAdvanced.length > 0;

    const hasAnyFilter =
      !(quickFilters.length === 1 && quickFilters[0] === "all") ||
      hasAdvancedFilters ||
      trimmedSearch.length > 0;

    return {
      quickFilters,
      muscleGroups,
      equipment,
      difficultiesAdvanced,
      search,
      hasAdvancedFilters,
      hasAnyFilter,
      filters,
      toggleQuickFilter,
      setSearch,
      applyAdvanced,
      clearAll,
    };
  }, [state, toggleQuickFilter, setSearch, applyAdvanced, clearAll]);

  return (
    <ExerciseFiltersContext.Provider value={value}>
      {children}
    </ExerciseFiltersContext.Provider>
  );
}
