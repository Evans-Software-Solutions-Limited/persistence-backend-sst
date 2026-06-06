import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { deleteExerciseCommand } from "@/application/commands/delete-exercise.command";
import {
  getExercisesQuery,
  refreshExerciseCache,
} from "@/application/queries/exercises.query";
import {
  filterExercises,
  sortExercisesByName,
} from "@/domain/services/exercise.service";
import { ExerciseListPresenter } from "@/ui/presenters/ExerciseListPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useDebouncedValue } from "@/ui/hooks/useDebouncedValue";
import { useExerciseFilters } from "@/ui/hooks/useExerciseFilters";
import { useExerciseLibrary } from "@/ui/hooks/useExerciseLibrary";
import { useReferenceLists } from "@/ui/hooks/useReferenceLists";

const SEARCH_DEBOUNCE_MS = 300;

export function ExerciseListContainer() {
  const { api, storage } = useAdapters();
  const router = useRouter();
  const {
    search,
    setSearch,
    // Reading `filtersWithoutSearch` (stable across `setSearch`) instead of
    // `filters` (recomputes on every keystroke because it includes `search`)
    // is what makes the debounce effective. If you swap this to `filters`,
    // the memo chain below runs per keystroke and `filterExercises` runs
    // over the full cache every press — defeating the 300ms debounce.
    filtersWithoutSearch,
    quickFilters,
    hasAdvancedFilters,
    toggleQuickFilter,
    clearAll,
  } = useExerciseFilters();

  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [cacheVersion, setCacheVersion] = useState(0);
  // Bumped by the Create-Exercise sheet (a sibling container) on a successful
  // create so this list re-reads the local cache and the new custom exercise
  // surfaces under "Mine" without an app reload (STORY-006 AC 6.5).
  const libraryRevision = useExerciseLibrary((s) => s.revision);

  const filters = useMemo(() => {
    const trimmed = debouncedSearch.trim();
    if (trimmed.length === 0) return filtersWithoutSearch;
    return { ...filtersWithoutSearch, search: trimmed };
  }, [filtersWithoutSearch, debouncedSearch]);

  // `hasAnyFilter` MUST reflect the same debounced search the query uses.
  // The hook's `hasAnyFilter` reads raw `search`, so during the 300ms
  // between "user clears a search that returned zero" and the debounce
  // settling, the list is still empty (old term applied) but the hook's
  // flag already flips to `false` — causing the presenter to briefly
  // render the default "Your library is empty" state instead of the
  // correct "Nothing matches". Deriving locally from the debounced
  // `filters` keeps flag + rendered results in lock-step.
  const hasAnyFilter = useMemo(
    () =>
      !(quickFilters.length === 1 && quickFilters[0] === "all") ||
      hasAdvancedFilters ||
      filters.search !== undefined,
    [quickFilters, hasAdvancedFilters, filters.search],
  );

  // Drive reference-list hydration + re-enrichment. The hook seeds the
  // adapter's id→label map from storage on mount (see useReferenceLists'
  // `initial` useMemo) AND exposes state that changes when a fresh
  // refresh lands — we depend on those below so exercise chip labels
  // rehydrate without a manual reload.
  const {
    muscleGroups: refMuscleGroups,
    equipment: refEquipment,
    categories: refCategories,
  } = useReferenceLists();

  // Cache read: the expensive step. `storage.getCachedExercises()` does
  // `SELECT data FROM cached_exercises` + JSON.parse × N rows (~2.3k in
  // prod). Memoising only on `[storage, cacheVersion]` means this runs
  // exactly once per cache mutation — NOT on every search keystroke.
  // Filtering is a separate, cheap, in-memory step below.
  const cacheRead = useMemo(() => {
    void cacheVersion;
    void libraryRevision;
    return getExercisesQuery(storage);
  }, [storage, cacheVersion, libraryRevision]);

  // -- Search ------------------------------------------------------------
  //
  // Search is LOCAL-ONLY: the offline-first SQLite cache holds the entire
  // exercise library (~2.3k rows, populated by `refreshExerciseCache`), and
  // `filterExercises` does complete tokenised, ranked matching over it in
  // sub-10ms. There is no server round-trip.
  //
  // An earlier build also fired the backend `/exercises/search` endpoint and
  // reconciled its async response with the local cache. That dual-source
  // design caused a visible flash/overwrite: correct local matches rendered
  // first, then got swapped for the (separately-ranked, sometimes
  // q-insensitive) server response when it landed. With the whole library
  // cached locally there's nothing the server can add that the local matcher
  // can't, so the round-trip was pure downside — removed. (`api.searchExercises`
  // and the backend FTS endpoint still exist for any future use.)
  const filtered = useMemo(() => {
    const matches = filterExercises(cacheRead.exercises, filters);
    // filterExercises ranks by relevance when a search term is present; for
    // the no-search browse list restore legacy alphabetical order (V2's cache
    // read is insertion-ordered, which buries newly-created customs at the
    // bottom — they read as "vanished" after the post-create flash).
    return filters.search ? matches : sortExercisesByName(matches);
  }, [cacheRead.exercises, filters]);

  // Label enrichment: re-stamp `primaryMuscleGroupLabels` /
  // `secondaryMuscleGroupLabels` / `equipmentLabels` using the adapter's
  // in-memory reverse lookup. Depends on the reference-list state so
  // that when a background refresh completes, the chips repopulate
  // without waiting for the next exercise refresh.
  const enrichedExercises = useMemo(() => {
    // Keep the ref arrays in the dep list; they're what actually
    // change when refs load. Reading them here is enough to make React
    // track the dep — we don't use the values directly because the
    // adapter holds the lookup map.
    void refMuscleGroups;
    void refEquipment;
    void refCategories;
    return filtered.map((ex) => api.enrichExerciseLabels(ex));
  }, [filtered, api, refMuscleGroups, refEquipment, refCategories]);

  // Compatibility wrapper: the presenter still reads from `queryResult`
  // shape. Surface lastSyncedAt + isStale from the cache read; the
  // exercises array is the filtered + enriched version.
  const queryResult = useMemo(
    () => ({
      exercises: enrichedExercises,
      lastSyncedAt: cacheRead.lastSyncedAt,
      isStale: cacheRead.isStale,
    }),
    [enrichedExercises, cacheRead.lastSyncedAt, cacheRead.isStale],
  );

  const isRefreshingRef = useRef(false);

  const triggerRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const result = await refreshExerciseCache(api, storage);
      if (!result.ok) {
        setRefreshError(result.error.message);
      }
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setCacheVersion((v) => v + 1);
      setIsRefreshing(false);
      isRefreshingRef.current = false;
    }
  }, [api, storage]);

  const hasTriggeredInitialRefreshRef = useRef(false);
  useEffect(() => {
    if (hasTriggeredInitialRefreshRef.current) return;
    hasTriggeredInitialRefreshRef.current = true;
    if (queryResult.isStale) {
      void triggerRefresh();
    }
  }, [queryResult.isStale, triggerRefresh]);

  const onOpenFilterModal = useCallback(() => {
    router.push("/(app)/exercises/filters");
  }, [router]);

  const onSelectExercise = useCallback(
    (id: string) => {
      router.push(`/(app)/exercises/${id}`);
    },
    [router],
  );

  const onCreateExercise = useCallback(() => {
    // Empty-state CTA → push the full-screen Create-Exercise route.
    router.push("/(app)/exercises/create");
  }, [router]);

  /**
   * Guard against accidental double-taps that would open two Alerts
   * (and ship two DELETE requests). Refs (not state) because Alert
   * presentation is asynchronous and a debounce via React state
   * would still allow the second trigger to land before the
   * re-render.
   */
  const isDeletePendingRef = useRef(false);

  /**
   * Holds the latest exercises array so `onLongPressExercise` can look
   * up the pressed row without depending on `queryResult.exercises` in
   * the useCallback deps. Keeping the callback's identity stable is
   * load-bearing: the presenter's `renderItem` depends on it, and an
   * unstable reference invalidates ExerciseCard's React.memo and
   * re-renders every visible cell on each filter/cache change.
   */
  const exercisesRef = useRef(queryResult.exercises);
  exercisesRef.current = queryResult.exercises;

  const onLongPressExercise = useCallback(
    (id: string) => {
      if (isDeletePendingRef.current) return;
      const exercise = exercisesRef.current.find((e) => e.id === id);
      // Only surface the destructive menu for rows the user owns —
      // system / PT exercises are non-deletable. Matches AC 7.5 +
      // legacy behaviour.
      if (!exercise || !exercise.isCustom) return;
      isDeletePendingRef.current = true;
      Alert.alert(
        `Delete ${exercise.name}?`,
        "This action cannot be undone.",
        [
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => {
              isDeletePendingRef.current = false;
            },
          },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                const result = await deleteExerciseCommand(
                  { api, storage },
                  id,
                );
                if (!result.ok) {
                  Alert.alert("Couldn't delete", result.error.message, [
                    { text: "OK" },
                  ]);
                } else {
                  // Bump cacheVersion so the list re-renders from
                  // the freshly-invalidated cache. Matches the
                  // pattern used by triggerRefresh.
                  setCacheVersion((v) => v + 1);
                }
              } finally {
                isDeletePendingRef.current = false;
              }
            },
          },
        ],
        {
          cancelable: true,
          // Android only — fires when the user taps outside the alert
          // or presses the hardware back button. Without this, neither
          // Cancel nor Delete onPress runs and the guard ref stays
          // true forever, blocking every subsequent long-press.
          onDismiss: () => {
            isDeletePendingRef.current = false;
          },
        },
      );
    },
    // queryResult.exercises intentionally NOT a dep — we read it via
    // exercisesRef so the callback identity stays stable across
    // cache changes. See the ref docstring above.
    [api, storage],
  );

  const hasCachedExercises = queryResult.exercises.length > 0;
  const showSkeleton =
    !hasCachedExercises && isRefreshing && queryResult.lastSyncedAt === null;
  const loadError =
    !hasCachedExercises && !isRefreshing && refreshError !== null
      ? refreshError
      : null;

  return (
    <ExerciseListPresenter
      exercises={queryResult.exercises}
      searchInput={search}
      selectedQuickFilters={quickFilters}
      hasAdvancedFilters={hasAdvancedFilters}
      hasAnyFilter={hasAnyFilter}
      lastSyncedAt={queryResult.lastSyncedAt}
      isStale={queryResult.isStale}
      isRefreshing={isRefreshing}
      showSkeleton={showSkeleton}
      loadError={loadError}
      onSearchChange={setSearch}
      onToggleQuickFilter={toggleQuickFilter}
      onOpenFilterModal={onOpenFilterModal}
      onClearFilters={clearAll}
      onRefresh={triggerRefresh}
      onSelectExercise={onSelectExercise}
      onCreateExercise={onCreateExercise}
      onLongPressExercise={onLongPressExercise}
    />
  );
}
