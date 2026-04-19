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
    filters: rawFilters,
    quickFilters,
    hasAdvancedFilters,
    hasAnyFilter,
    toggleQuickFilter,
    clearAll,
  } = useExerciseFilters();

  // Debounce the search text into the filters object the query sees.
  // The context holds the raw input so the modal/UI can render it live;
  // `rawFilters.search` mirrors it, so we override just the search field
  // after the 300ms settle to avoid re-filtering on every keystroke.
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [cacheVersion, setCacheVersion] = useState(0);

  const filters = useMemo(() => {
    const f = { ...rawFilters };
    const trimmed = debouncedSearch.trim();
    if (trimmed.length > 0) {
      f.search = trimmed;
    } else {
      delete f.search;
    }
    return f;
  }, [rawFilters, debouncedSearch]);

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
