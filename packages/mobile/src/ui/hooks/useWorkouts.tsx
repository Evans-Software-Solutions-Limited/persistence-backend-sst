import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getWorkoutsQuery,
  refreshAllWorkouts,
  type WorkoutsQueryResult,
} from "@/application/queries/workouts.query";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * React hook exposing the three workouts list slices (mine / assigned /
 * default) to the Workouts tab. Mirrors `useDashboard` (M1) line-for-
 * line — same cache-first read, same in-flight dedupe keyed on userId,
 * same stale-closure guard, same one-shot auto-refresh.
 *
 * Spec: specs/04-workout-management/design.md § Offline Strategy
 *       specs/04-workout-management/requirements.md STORY-001 ACs 1.6, 1.8
 *       STORY-008 AC 8.4
 */

export type WorkoutsState = WorkoutsQueryResult & {
  isRefreshing: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
};

const EMPTY_QUERY_RESULT: WorkoutsQueryResult = {
  mine: { workouts: [], quota: null, isStale: true, cached: null },
  assigned: { workouts: [], quota: null, isStale: true, cached: null },
  default: { workouts: [], quota: null, isStale: true, cached: null },
};

export function useWorkouts(): WorkoutsState {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const [cacheVersion, setCacheVersion] = useState(0);

  const initial = useMemo<WorkoutsQueryResult>(() => {
    void cacheVersion;
    if (!userId) return EMPTY_QUERY_RESULT;
    return getWorkoutsQuery(storage, userId);
  }, [storage, userId, cacheVersion]);

  const [snapshot, setSnapshot] = useState<WorkoutsQueryResult>(initial);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    setSnapshot(initial);
  }, [initial]);

  const latestUserIdRef = useRef<string | null>(userId);
  useEffect(() => {
    latestUserIdRef.current = userId;
  }, [userId]);

  const inFlightRef = useRef<{
    userId: string;
    promise: Promise<void>;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    if (inFlightRef.current && inFlightRef.current.userId === userId) {
      return inFlightRef.current.promise;
    }
    setIsRefreshing(true);
    setError(null);
    const work = (async () => {
      try {
        const results = await refreshAllWorkouts(api, storage, userId);
        if (latestUserIdRef.current !== userId) return;
        // Surface the first error we see; cache writes for successful
        // sections already happened inside refreshWorkouts.
        const firstFail =
          (!results.mine.ok && results.mine.error) ||
          (!results.assigned.ok && results.assigned.error) ||
          (!results.default.ok && results.default.error);
        if (firstFail) setError(firstFail);
        setSnapshot(getWorkoutsQuery(storage, userId));
        setCacheVersion((v) => v + 1);
      } finally {
        setIsRefreshing(false);
        if (inFlightRef.current?.userId === userId) {
          inFlightRef.current = null;
        }
      }
    })();
    inFlightRef.current = { userId, promise: work };
    return work;
  }, [api, storage, userId]);

  // One-shot auto-refresh when any section is stale (or no cache).
  const autoRefreshedForUserRef = useRef<string | null>(null);
  const anyStale =
    initial.mine.isStale || initial.assigned.isStale || initial.default.isStale;
  useEffect(() => {
    if (!userId) {
      autoRefreshedForUserRef.current = null;
      return;
    }
    if (autoRefreshedForUserRef.current === userId) return;
    if (!anyStale) return;
    autoRefreshedForUserRef.current = userId;
    void refresh();
  }, [userId, anyStale, refresh]);

  return {
    ...snapshot,
    isRefreshing,
    error,
    refresh,
  };
}
