import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getExercisesQuery,
  refreshExerciseCache,
} from "@/application/queries/exercises.query";
import { ExerciseListPresenter } from "@/ui/presenters/ExerciseListPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useDebouncedValue } from "@/ui/hooks/useDebouncedValue";
import { useExerciseFilters } from "@/ui/hooks/useExerciseFilters";

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

  const queryResult = useMemo(() => {
    void cacheVersion;
    return getExercisesQuery(storage, filters);
  }, [storage, filters, cacheVersion]);

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
    />
  );
}
