import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isWorkoutDetailStale,
  type CachedWorkoutDetail,
  type Workout,
} from "@/domain/models/workout";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Single-workout hook backing the editor's initial load + the popover
 * detail view. Cache-first: synchronous read from
 * `cached_workout_detail`, one-shot background refresh against
 * `GET /workouts/:id` when the cached row is stale or missing. Mirrors
 * `useDashboard` line-for-line — same in-flight dedupe keyed on
 * `(userId, workoutId)`, same stale-closure guard, same auto-refresh
 * arming on identity changes.
 *
 * Spec: specs/04-workout-management/design.md § Offline Strategy
 *       specs/04-workout-management/requirements.md STORY-007 ACs 7.1, 7.4
 *       STORY-004 AC 4.3
 */

export type WorkoutDetailState = {
  workout: Workout | null;
  isLoading: boolean;
  isStale: boolean;
  error: ApiError | null;
  syncedAt: string | null;
  refresh: () => Promise<void>;
};

const EMPTY: WorkoutDetailState = {
  workout: null,
  isLoading: false,
  isStale: true,
  error: null,
  syncedAt: null,
  refresh: async () => {},
};

export function useWorkout(workoutId: string | null): WorkoutDetailState {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const [cacheVersion, setCacheVersion] = useState(0);

  const initial = useMemo(() => {
    void cacheVersion;
    if (!userId || !workoutId) {
      return {
        cached: null as CachedWorkoutDetail | null,
        isStale: true,
      };
    }
    const cached = storage.getCachedWorkoutDetail(userId, workoutId);
    return { cached, isStale: isWorkoutDetailStale(cached) };
  }, [storage, userId, workoutId, cacheVersion]);

  const [workout, setWorkout] = useState<Workout | null>(
    initial.cached?.workout ?? null,
  );
  const [isStale, setIsStale] = useState<boolean>(initial.isStale);
  const [syncedAt, setSyncedAt] = useState<string | null>(
    initial.cached?.syncedAt ?? null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    setWorkout(initial.cached?.workout ?? null);
    setIsStale(initial.isStale);
    setSyncedAt(initial.cached?.syncedAt ?? null);
  }, [initial]);

  // Mirror the live identity to a ref so an async refresh can detect
  // session/workout swaps mid-flight and skip the writes that would
  // pollute state. Same pattern as useDashboard.
  const latestKeyRef = useRef<string | null>(
    userId && workoutId ? `${userId}::${workoutId}` : null,
  );
  useEffect(() => {
    latestKeyRef.current =
      userId && workoutId ? `${userId}::${workoutId}` : null;
  }, [userId, workoutId]);

  const inFlightRef = useRef<{
    key: string;
    promise: Promise<void>;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!userId || !workoutId) return;
    const key = `${userId}::${workoutId}`;
    if (inFlightRef.current && inFlightRef.current.key === key) {
      return inFlightRef.current.promise;
    }
    setIsLoading(true);
    setError(null);
    const work = (async () => {
      try {
        const result = await api.getWorkout(workoutId);
        if (latestKeyRef.current !== key) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        storage.cacheWorkoutDetail(userId, result.value);
        setWorkout(result.value);
        setIsStale(false);
        setSyncedAt(new Date().toISOString());
        setCacheVersion((v) => v + 1);
      } finally {
        setIsLoading(false);
        if (inFlightRef.current?.key === key) {
          inFlightRef.current = null;
        }
      }
    })();
    inFlightRef.current = { key, promise: work };
    return work;
  }, [api, storage, userId, workoutId]);

  // One-shot auto-refresh per (user, workout) identity when stale or
  // missing. Re-arms on identity change.
  const autoRefreshedForKeyRef = useRef<string | null>(null);
  const initialIsStale = initial.isStale;
  useEffect(() => {
    if (!userId || !workoutId) {
      autoRefreshedForKeyRef.current = null;
      return;
    }
    const key = `${userId}::${workoutId}`;
    if (autoRefreshedForKeyRef.current === key) return;
    if (!initialIsStale) return;
    autoRefreshedForKeyRef.current = key;
    void refresh();
  }, [userId, workoutId, initialIsStale, refresh]);

  if (!userId || !workoutId) return EMPTY;

  return {
    workout,
    isLoading,
    isStale,
    error,
    syncedAt,
    refresh,
  };
}
