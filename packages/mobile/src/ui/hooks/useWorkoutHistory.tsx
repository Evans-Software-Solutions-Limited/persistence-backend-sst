import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isWorkoutHistoryStale,
  type CachedWorkoutHistory,
  type WorkoutHistory,
} from "@/domain/models/workout";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Per-workout completed-session history for the detail hero's market-standard
 * stats block (LAST DONE / COMPLETED × / AVG TIME + last-session recap).
 *
 * Cache-first (mirrors `useWorkout`): a read from `cached_workout_history`
 * renders as soon as the session resolves, then a one-shot background refresh
 * against `GET /workouts/:id/history` fires when the cached row is stale or
 * missing. Offline / errored the last-known history stays on screen (the block
 * is a non-critical stat panel); a `null` history + a `completedCount === 0`
 * history both read as "no history yet" in the presenter. Optimistic `local-`
 * ids never fetch (no server row yet).
 *
 * `isLoading` is DERIVED each render (not a separate state) so it can't stick
 * true after a same-mount workoutId swap and doesn't flash "Not done yet"
 * before an imminent first fetch — it's true only when we have nothing to show
 * (no cache) and the fetch for THIS identity hasn't resolved yet.
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/requirements.md STORY-005 AC 5.2
 *       (S2 offline-cache upgrade of the original online-direct hook)
 */

export type WorkoutHistoryState = {
  history: WorkoutHistory | null;
  isLoading: boolean;
  error: ApiError | null;
};

/** Optimistic ids have never been completed + don't exist server-side. */
function isFetchable(userId: string | null, workoutId: string | null): boolean {
  return !!userId && !!workoutId && !workoutId.startsWith("local-");
}

export function useWorkoutHistory(
  workoutId: string | null,
): WorkoutHistoryState {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const fetchable = isFetchable(userId, workoutId);
  const key = fetchable ? `${userId}::${workoutId}` : null;

  const [cacheVersion, setCacheVersion] = useState(0);

  const initial = useMemo(() => {
    void cacheVersion;
    if (!fetchable) {
      return { cached: null as CachedWorkoutHistory | null, isStale: true };
    }
    const cached = storage.getCachedWorkoutHistory(
      userId as string,
      workoutId as string,
    );
    return { cached, isStale: isWorkoutHistoryStale(cached) };
  }, [storage, userId, workoutId, fetchable, cacheVersion]);

  const [history, setHistory] = useState<WorkoutHistory | null>(
    initial.cached?.history ?? null,
  );
  const [error, setError] = useState<ApiError | null>(null);
  // The identity whose fetch has settled (resolved or errored). Lets the
  // derived `isLoading` fall to false after an error that left no cache.
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);

  useEffect(() => {
    setHistory(initial.cached?.history ?? null);
  }, [initial]);

  // Mirror the live (userId, workoutId) to a ref so a slow refresh can't write
  // state for a workout the user has since navigated away from.
  const latestKeyRef = useRef<string | null>(key);
  useEffect(() => {
    latestKeyRef.current = key;
  }, [key]);

  // Single-shot per identity (the one-shot auto-refresh effect is the only
  // caller — no pull-to-refresh here), so no in-flight dedupe is needed; the
  // `latestKeyRef` guard still prevents a mid-flight identity swap writing
  // stale state.
  const refresh = useCallback(async () => {
    const fetchKey = `${userId}::${workoutId}`;
    setError(null);
    try {
      const result = await api.getWorkoutHistory(workoutId as string);
      if (latestKeyRef.current !== fetchKey) return;
      if (!result.ok) {
        // Non-fatal: keep whatever cached history is already on screen.
        setError(result.error);
        return;
      }
      storage.cacheWorkoutHistory(
        userId as string,
        workoutId as string,
        result.value,
      );
      setHistory(result.value);
      setCacheVersion((v) => v + 1);
    } finally {
      // Mark this identity settled so the empty state can show after an
      // errored first fetch (only when the identity is still current).
      if (latestKeyRef.current === fetchKey) setResolvedKey(fetchKey);
    }
  }, [api, storage, userId, workoutId]);

  // One-shot auto-refresh per identity when the cache is stale/missing.
  const autoRefreshedForKeyRef = useRef<string | null>(null);
  const initialIsStale = initial.isStale;
  useEffect(() => {
    if (!fetchable) {
      autoRefreshedForKeyRef.current = null;
      return;
    }
    if (autoRefreshedForKeyRef.current === key) return;
    if (!initialIsStale) return;
    autoRefreshedForKeyRef.current = key;
    void refresh();
  }, [fetchable, key, initialIsStale, refresh]);

  // Loading only when we have nothing to show yet and this identity's fetch
  // hasn't settled. A present (even stale) cache → not loading (show it).
  const isLoading =
    key !== null && history === null && initial.isStale && resolvedKey !== key;

  return { history, isLoading, error };
}
