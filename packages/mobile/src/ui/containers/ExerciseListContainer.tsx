import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EquipmentType,
  ExerciseCategory,
  ExerciseDifficulty,
  ExerciseFilters,
  MuscleGroup,
} from "@/domain/models/exercise";
import {
  getExercisesQuery,
  refreshExerciseCache,
} from "@/application/queries/exercises.query";
import { ExerciseListPresenter } from "@/ui/presenters/ExerciseListPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useDebouncedValue } from "@/ui/hooks/useDebouncedValue";

const SEARCH_DEBOUNCE_MS = 300;

export function ExerciseListContainer() {
  const { api, storage } = useAdapters();
  const router = useRouter();

  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);
  const [equipment, setEquipment] = useState<EquipmentType[]>([]);
  const [category, setCategory] = useState<ExerciseCategory | null>(null);
  const [difficulty, setDifficulty] = useState<ExerciseDifficulty | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Increment after any cache mutation so `getExercisesQuery` re-reads.
  const [cacheVersion, setCacheVersion] = useState(0);

  const filters = useMemo<ExerciseFilters>(() => {
    const f: ExerciseFilters = {};
    const trimmed = debouncedSearch.trim();
    if (trimmed.length > 0) f.search = trimmed;
    if (muscleGroups.length > 0) f.muscleGroups = muscleGroups;
    if (equipment.length > 0) f.equipment = equipment;
    if (category !== null) f.category = category;
    if (difficulty !== null) f.difficulty = difficulty;
    return f;
  }, [debouncedSearch, muscleGroups, equipment, category, difficulty]);

  // `cacheVersion` is intentionally part of the dep array so the query
  // re-runs against fresh storage after a background refresh writes rows.
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

  // Background refresh on first mount when cache is stale.
  const hasTriggeredInitialRefreshRef = useRef(false);
  useEffect(() => {
    if (hasTriggeredInitialRefreshRef.current) return;
    hasTriggeredInitialRefreshRef.current = true;
    if (queryResult.isStale) {
      void triggerRefresh();
    }
  }, [queryResult.isStale, triggerRefresh]);

  const onToggleMuscleGroup = useCallback((group: MuscleGroup) => {
    setMuscleGroups((prev) =>
      prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group],
    );
  }, []);

  const onToggleEquipment = useCallback((eq: EquipmentType) => {
    setEquipment((prev) =>
      prev.includes(eq) ? prev.filter((e) => e !== eq) : [...prev, eq],
    );
  }, []);

  const onClearFilters = useCallback(() => {
    setMuscleGroups([]);
    setEquipment([]);
    setCategory(null);
    setDifficulty(null);
    setSearchInput("");
  }, []);

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
      searchInput={searchInput}
      muscleGroups={muscleGroups}
      equipment={equipment}
      category={category}
      difficulty={difficulty}
      lastSyncedAt={queryResult.lastSyncedAt}
      isStale={queryResult.isStale}
      isRefreshing={isRefreshing}
      showSkeleton={showSkeleton}
      loadError={loadError}
      onSearchChange={setSearchInput}
      onToggleMuscleGroup={onToggleMuscleGroup}
      onToggleEquipment={onToggleEquipment}
      onSelectCategory={setCategory}
      onSelectDifficulty={setDifficulty}
      onClearFilters={onClearFilters}
      onRefresh={triggerRefresh}
      onSelectExercise={onSelectExercise}
      onCreateExercise={onCreateExercise}
    />
  );
}
