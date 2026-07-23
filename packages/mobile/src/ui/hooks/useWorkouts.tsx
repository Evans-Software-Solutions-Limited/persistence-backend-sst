import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import {
  getWorkoutsQuery,
  refreshAllWorkouts,
  type WorkoutsQueryResult,
} from "@/application/queries/workouts.query";
import type { ApiError } from "@/shared/errors";
import { useUserMode } from "@/state/user-mode";
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
  /** `{ silent: true }` refreshes without toggling `isRefreshing` (focus). */
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  /**
   * Re-read the cache without hitting the network. Use this when an
   * external mutation (e.g. a workout created from the modal stack)
   * has updated the SQLite cache and the list needs to pick up the
   * new state — `refresh()` would also re-hit the API, which isn't
   * needed if the cache is the source of truth for the new row.
   */
  rereadCache: () => void;
};

const EMPTY_QUERY_RESULT: WorkoutsQueryResult = {
  mine: { workouts: [], quota: null, isStale: true, cached: null },
  assigned: { workouts: [], quota: null, isStale: true, cached: null },
  default: { workouts: [], quota: null, isStale: true, cached: null },
};

export function useWorkouts(): WorkoutsState {
  const { api, auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  // Trainers get a de-crowded personal list: the `mine` section is fetched
  // with ownerLibraryOnly so workouts they authored FOR CLIENTS (flagged
  // not owner-visible) don't clutter their own Home carousel / My Workouts.
  // Regular athletes are unaffected (isTrainerEligible false → no filter).
  const isTrainerEligible = useUserMode((s) => s.isTrainerEligible);

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

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!userId) return;
      if (inFlightRef.current && inFlightRef.current.userId === userId) {
        return inFlightRef.current.promise;
      }
      const showSpinner = !opts?.silent;
      if (showSpinner) setIsRefreshing(true);
      setError(null);
      const work = (async () => {
        try {
          // Drain the sync queue BEFORE fetching. Otherwise the GET races
          // any pending POST/PATCH/DELETE — the server returns a list
          // that doesn't yet reflect the user's optimistic mutation, the
          // adapter overwrites cache with the stale response, and the
          // optimistic row vanishes (or in the delete case, comes back).
          // Flushing first means the server sees every queued mutation
          // before we ask it for the canonical list.
          try {
            await processSyncQueue(storage, auth, getApiBaseUrl());
          } catch (err) {
            // Queue worker errors are isolated per-entry inside
            // processSyncQueue; an outer throw means a shell-level
            // failure (e.g. base-URL config). Log and continue —
            // refusing to refresh would be worse than fetching.
            console.error("[useWorkouts] queue flush failed:", err);
          }
          if (latestUserIdRef.current !== userId) return;
          const results = await refreshAllWorkouts(
            api,
            storage,
            userId,
            isTrainerEligible,
          );
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
          if (showSpinner) setIsRefreshing(false);
          if (inFlightRef.current?.userId === userId) {
            inFlightRef.current = null;
          }
        }
      })();
      inFlightRef.current = { userId, promise: work };
      return work;
    },
    [api, auth, storage, userId, isTrainerEligible],
  );

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

  // Soft re-read: bump cacheVersion so `initial` recomputes from
  // storage. Stable identity (no deps) so callers can safely list it
  // in `useFocusEffect` / `useEffect` deps without re-firing.
  const rereadCache = useCallback(() => {
    setCacheVersion((v) => v + 1);
  }, []);

  return {
    ...snapshot,
    isRefreshing,
    error,
    refresh,
    rereadCache,
  };
}
