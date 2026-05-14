import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { deleteExerciseCommand } from "@/application/commands/delete-exercise.command";
import {
  getExercisesQuery,
  refreshExerciseCache,
} from "@/application/queries/exercises.query";
import type { Exercise } from "@/domain/models/exercise";
import { filterExercises } from "@/domain/services/exercise.service";
import { ExerciseListPresenter } from "@/ui/presenters/ExerciseListPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useDebouncedValue } from "@/ui/hooks/useDebouncedValue";
import { useExerciseFilters } from "@/ui/hooks/useExerciseFilters";
import { useReferenceLists } from "@/ui/hooks/useReferenceLists";

const SEARCH_DEBOUNCE_MS = 300;
/**
 * Threshold for kicking off a server-side ranked search. Below this we
 * stick with the local cache + filterExercises path — single-char prefix
 * queries return almost the entire catalogue and aren't worth a round
 * trip. Matches the backend's `MIN_SEARCH_LENGTH`.
 */
const SERVER_SEARCH_MIN_LENGTH = 2;
/**
 * Page size for the server search call. The picker caps at 100; matching
 * here keeps the contract consistent and prevents a 1k-row payload from
 * the server outranking what the UI can render.
 */
const SERVER_SEARCH_LIMIT = 100;

type ServerSearchState = {
  /** The exact trimmed query this state corresponds to. */
  q: string;
  results: Exercise[];
  isFetching: boolean;
  /** Non-null when the network call failed → caller falls back to cache. */
  error: string | null;
};

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
    return getExercisesQuery(storage);
  }, [storage, cacheVersion]);

  // -- Server-side ranked search (FTS + trigram) -------------------------
  //
  // When the debounced search term hits 2+ chars we fire the backend
  // `/exercises/search` endpoint. The ranked results replace the local
  // filter for the search axis. The local cache + filterExercises path
  // is preserved for: short queries, the empty-search state, and as a
  // graceful fallback when the network call errors (offline-ish
  // semantics without an explicit NetInfo dependency).
  const [serverSearch, setServerSearch] = useState<ServerSearchState | null>(
    null,
  );

  useEffect(() => {
    const q = debouncedSearch.trim();
    if (q.length < SERVER_SEARCH_MIN_LENGTH) {
      setServerSearch(null);
      return;
    }
    let cancelled = false;
    setServerSearch((prev) => ({
      q,
      // Keep prior results visible during a refetch so the list doesn't
      // flicker to empty between keystrokes.
      results: prev?.results ?? [],
      isFetching: true,
      error: null,
    }));
    void api.searchExercises(q, 0, SERVER_SEARCH_LIMIT).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setServerSearch({
          q,
          results: result.value.data,
          isFetching: false,
          error: null,
        });
      } else {
        setServerSearch({
          q,
          results: [],
          isFetching: false,
          error: result.error.message,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, api]);

  /**
   * The server's ranked results are the source of truth iff:
   *  - we have a serverSearch state for the *current* debounced query
   *    (avoids stale results outliving a query change)
   *  - the call didn't error (otherwise fall through to cache + local)
   *
   * When the server is the source, we apply `filtersWithoutSearch` over
   * its results — the server already filtered + ranked by the search
   * axis. When the cache is the source, we apply the full `filters`
   * (including the local search term) so the offline / pre-server-
   * response state still gets a meaningful filter.
   */
  const useServerResults =
    serverSearch != null &&
    serverSearch.q === debouncedSearch.trim() &&
    serverSearch.error == null &&
    !serverSearch.isFetching;

  const filtered = useMemo(() => {
    if (useServerResults && serverSearch != null) {
      // Filter axes other than search are applied client-side against
      // the server's ranked page. Order is preserved by filterExercises
      // when no `search` axis is present (no relevance re-rank).
      return filterExercises(serverSearch.results, filtersWithoutSearch);
    }
    return filterExercises(cacheRead.exercises, filters);
  }, [
    useServerResults,
    serverSearch,
    filtersWithoutSearch,
    cacheRead.exercises,
    filters,
  ]);

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
