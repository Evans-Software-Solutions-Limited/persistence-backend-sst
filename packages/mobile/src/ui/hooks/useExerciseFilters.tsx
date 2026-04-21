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
  muscleGroups: string[];
  equipment: string[];
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
  muscleGroups: string[];
  equipment: string[];
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
  /**
   * The `ExerciseFilters` shape with every axis EXCEPT `search`. This memo's
   * reference is stable across `setSearch` calls, so consumers that need to
   * apply a debounced search can merge it on top without their own memos
   * recomputing on every keystroke. Use this in the list container with
   * `useDebouncedValue(search)` — do NOT use `filters` directly for query
   * input or the 300ms debounce is defeated (new object reference per
   * keystroke cascades through useMemo deps and re-runs filterExercises).
   */
  filtersWithoutSearch: ExerciseFilters;

  // --- actions ---
  toggleQuickFilter: (id: QuickFilterId) => void;
  setSearch: (text: string) => void;
  applyAdvanced: (next: {
    muscleGroups: string[];
    equipment: string[];
    difficulties: ExerciseDifficulty[];
  }) => void;
  clearAll: () => void;

  /**
   * Build the `ExerciseFilters` shape that would be produced if the given
   * advanced state were committed via `applyAdvanced`. Intended for the
   * filter modal's live-count preview: the modal has uncommitted pending
   * values, but the returned filters must still include constraints from
   * the committed axes it doesn't own (quick-filter difficulties, quick
   * createdBy, search, category).
   *
   * Centralising this prevents drift between the committed merge (in
   * `filtersWithoutSearch`) and any manual recomputation downstream — a
   * bug that crept in when difficulty was shared across quick bar + modal.
   */
  previewFiltersWithAdvanced: (override: {
    muscleGroups: string[];
    equipment: string[];
    difficulties: ExerciseDifficulty[];
  }) => ExerciseFilters;
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
      muscleGroups: string[];
      equipment: string[];
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

  // Destructure non-search state out so we can memoise `filtersWithoutSearch`
  // with stable dependencies across `setSearch` calls. Using `state` directly
  // would recompute every keystroke and defeat the consumer's debounce.
  const {
    quickFilters,
    muscleGroups,
    equipment,
    difficultiesAdvanced,
    search,
  } = state;

  /**
   * Single source of truth for the quick-filter + advanced-filter merge.
   * Used by both the live memo and the `previewFiltersWithAdvanced` helper.
   * Consumers that need the preview variant (filter modal live count) call
   * this with uncommitted pending values; the committed memo calls it with
   * the current state. Keeps both paths in lock-step.
   */
  const mergeFilters = useCallback(
    (override: {
      muscleGroups: string[];
      equipment: string[];
      difficultiesAdvanced: ExerciseDifficulty[];
    }): ExerciseFilters => {
      const quickCreatedBy = quickFilters.find(isCreatedBy) ?? null;
      const quickDifficulties = quickFilters.filter(isDifficulty);

      // Quick-filter difficulties and advanced (modal) difficulties union.
      // Deduplicated to keep the query payload stable.
      const mergedDifficultySet = new Set<ExerciseDifficulty>([
        ...quickDifficulties,
        ...override.difficultiesAdvanced,
      ]);

      const f: ExerciseFilters = {};
      if (override.muscleGroups.length > 0)
        f.muscleGroups = override.muscleGroups;
      if (override.equipment.length > 0) f.equipment = override.equipment;
      if (mergedDifficultySet.size > 0) {
        f.difficulties = Array.from(mergedDifficultySet);
      }
      if (quickCreatedBy !== null) f.createdBy = quickCreatedBy;
      return f;
    },
    [quickFilters],
  );

  const filtersWithoutSearch = useMemo<ExerciseFilters>(
    () =>
      mergeFilters({
        muscleGroups,
        equipment,
        difficultiesAdvanced,
      }),
    [mergeFilters, muscleGroups, equipment, difficultiesAdvanced],
  );

  const previewFiltersWithAdvanced = useCallback(
    (override: {
      muscleGroups: string[];
      equipment: string[];
      difficulties: ExerciseDifficulty[];
    }): ExerciseFilters => {
      const base = mergeFilters({
        muscleGroups: override.muscleGroups,
        equipment: override.equipment,
        difficultiesAdvanced: override.difficulties,
      });
      const trimmed = search.trim();
      if (trimmed.length === 0) return base;
      return { ...base, search: trimmed };
    },
    [mergeFilters, search],
  );

  // `filters` intentionally wraps `filtersWithoutSearch` rather than inlining
  // the same logic — when only `search` changes, only this memo recomputes.
  // Consumers that can tolerate live search (e.g. the filter-modal's match
  // count) use this; the list container uses `filtersWithoutSearch` + a
  // debounced search merge to avoid re-running `filterExercises` per keystroke.
  const filters = useMemo<ExerciseFilters>(() => {
    const trimmed = search.trim();
    if (trimmed.length === 0) return filtersWithoutSearch;
    return { ...filtersWithoutSearch, search: trimmed };
  }, [filtersWithoutSearch, search]);

  const hasAdvancedFilters = useMemo(
    () =>
      muscleGroups.length > 0 ||
      equipment.length > 0 ||
      difficultiesAdvanced.length > 0,
    [muscleGroups, equipment, difficultiesAdvanced],
  );

  const hasAnyFilter = useMemo(
    () =>
      !(quickFilters.length === 1 && quickFilters[0] === "all") ||
      hasAdvancedFilters ||
      search.trim().length > 0,
    [quickFilters, hasAdvancedFilters, search],
  );

  const value = useMemo<ExerciseFiltersContextValue>(
    () => ({
      quickFilters,
      muscleGroups,
      equipment,
      difficultiesAdvanced,
      search,
      hasAdvancedFilters,
      hasAnyFilter,
      filters,
      filtersWithoutSearch,
      toggleQuickFilter,
      setSearch,
      applyAdvanced,
      clearAll,
      previewFiltersWithAdvanced,
    }),
    [
      quickFilters,
      muscleGroups,
      equipment,
      difficultiesAdvanced,
      search,
      hasAdvancedFilters,
      hasAnyFilter,
      filters,
      filtersWithoutSearch,
      toggleQuickFilter,
      setSearch,
      applyAdvanced,
      clearAll,
      previewFiltersWithAdvanced,
    ],
  );

  return (
    <ExerciseFiltersContext.Provider value={value}>
      {children}
    </ExerciseFiltersContext.Provider>
  );
}
