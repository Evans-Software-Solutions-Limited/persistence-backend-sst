import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Exercise } from "@/domain/models/exercise";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";

/**
 * Single-exercise hook backing the detail screen + the editor's initial load.
 * Cache-first: synchronous read from the shared `cached_exercises` store, with
 * a one-shot background fetch against `GET /exercises/:id` when the row isn't
 * cached yet (e.g. a deep link to an id the library refresh hasn't pulled).
 * Mirrors `useWorkout` — same in-flight dedupe + stale-closure guard keyed on
 * the exercise id, same auto-refresh arming on identity change.
 *
 * Exercises are a shared library (system rows + every user's customs), so the
 * cache isn't user-scoped and the read key is just `id`. Ownership is derived
 * downstream from `exercise.createdBy`.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-007 (AC 7.1, 7.2)
 *       design.md § <ExerciseDetailPresenter>
 */

export type ExerciseDetailState = {
  exercise: Exercise | null;
  isLoading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
};

const EMPTY: ExerciseDetailState = {
  exercise: null,
  isLoading: false,
  error: null,
  refresh: async () => {},
};

export function useExercise(id: string | null): ExerciseDetailState {
  const { api, storage } = useAdapters();

  const [cacheVersion, setCacheVersion] = useState(0);

  const initial = useMemo(() => {
    void cacheVersion;
    if (!id) return null;
    return storage.getCachedExercise(id);
  }, [storage, id, cacheVersion]);

  const [exercise, setExercise] = useState<Exercise | null>(initial);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    setExercise(initial);
  }, [initial]);

  // Mirror the live id to a ref so an async fetch can detect an id swap
  // mid-flight and skip the writes that would pollute state.
  const latestIdRef = useRef<string | null>(id);
  useEffect(() => {
    latestIdRef.current = id;
  }, [id]);

  const inFlightRef = useRef<{ id: string; promise: Promise<void> } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    if (!id) return;
    if (inFlightRef.current && inFlightRef.current.id === id) {
      return inFlightRef.current.promise;
    }
    setIsLoading(true);
    setError(null);
    const work = (async () => {
      try {
        const result = await api.getExercise(id);
        if (latestIdRef.current !== id) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        storage.cacheExercises([result.value]);
        setExercise(result.value);
        setCacheVersion((v) => v + 1);
      } finally {
        setIsLoading(false);
        if (inFlightRef.current?.id === id) {
          inFlightRef.current = null;
        }
      }
    })();
    inFlightRef.current = { id, promise: work };
    return work;
  }, [api, storage, id]);

  // One-shot auto-fetch per id when the row isn't cached. A cached row renders
  // immediately and skips the network — the library refresh keeps it fresh.
  const autoFetchedForIdRef = useRef<string | null>(null);
  const hasInitial = initial !== null;
  useEffect(() => {
    if (!id) {
      autoFetchedForIdRef.current = null;
      return;
    }
    if (autoFetchedForIdRef.current === id) return;
    if (hasInitial) return;
    autoFetchedForIdRef.current = id;
    void refresh();
  }, [id, hasInitial, refresh]);

  if (!id) return EMPTY;

  return { exercise, isLoading, error, refresh };
}
