import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { getDashboardQuery } from "@/application/queries/dashboard.query";
import type { DashboardPayload } from "@/domain/models/dashboard";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * React hook exposing the dashboard cache to the Home tab.
 *
 * - Reads synchronously from StoragePort on mount (cache-first).
 * - If the cache is empty or stale, fires a background refresh exactly
 *   once per mount.
 * - `refresh()` always re-fetches, bypassing the TTL (pull-to-refresh).
 * - Failure leaves the cached payload intact; `error` surfaces so the
 *   UI can show a non-blocking indicator.
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard mobile architecture
 *       (M1) · requirements.md STORY-005 AC 5.9, 5.10
 */

export type DashboardState = {
  /** Cached payload, or null if the cache is empty. */
  payload: DashboardPayload | null;
  /** True when the cache is empty or past the 5-minute TTL. */
  isStale: boolean;
  /** True while a refresh call is in flight. */
  isRefreshing: boolean;
  /** Last error from a refresh attempt; cleared on next successful refresh. */
  error: ApiError | null;
  /** ISO timestamp of the last successful cache write, or null. */
  syncedAt: string | null;
  /** Force a refresh, bypassing the TTL. Resolves when done. */
  refresh: () => Promise<void>;
};

export function useDashboard(): DashboardState {
  const { api, auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  // 1st memo — synchronous cache read. Recomputes when the signed-in
  // user changes or a refresh completes (cacheVersion ticks). Reading
  // `cacheVersion` inside the factory (even via `void`) is what makes
  // React re-run this memo when `refresh()` bumps the counter.
  const [cacheVersion, setCacheVersion] = useState(0);

  const initial = useMemo(() => {
    void cacheVersion;
    if (!userId) {
      return { payload: null, isStale: true, syncedAt: null as string | null };
    }
    const { payload, isStale, cached } = getDashboardQuery(storage, userId);
    return {
      payload,
      isStale,
      syncedAt: cached?.syncedAt ?? null,
    };
  }, [storage, userId, cacheVersion]);

  const [payload, setPayload] = useState<DashboardPayload | null>(
    initial.payload,
  );
  const [isStale, setIsStale] = useState(initial.isStale);
  const [syncedAt, setSyncedAt] = useState<string | null>(initial.syncedAt);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Re-sync local state when the cache read produces fresh values
  // (e.g. after a sign-in swaps `userId`).
  useEffect(() => {
    setPayload(initial.payload);
    setIsStale(initial.isStale);
    setSyncedAt(initial.syncedAt);
  }, [initial]);

  // Mirror the live userId into a ref so a refresh IIFE can check
  // whether the session is still the one it started against. Without
  // this guard, a refresh that started for user-1 could complete after
  // sign-out and pollute state / storage with user-1's payload under
  // user-1's key — undoing sign-out cleanup. The ref is always one
  // step ahead of the closure-captured `userId` inside a stale
  // refresh. See bugbot thread on PR #37.
  const latestUserIdRef = useRef<string | null>(userId);
  useEffect(() => {
    latestUserIdRef.current = userId;
  }, [userId]);

  // Dedupe concurrent refresh() calls onto a single in-flight promise,
  // BUT only when they're for the same user. Cross-user dedupe was a
  // bug — sign-out during an in-flight refresh, then sign-in as a
  // different user, would have the new user's auto-refresh silently
  // consume the stale user-1 promise via the guard below, leaving
  // user-2's dashboard empty. Keying the ref on userId means user-2's
  // refresh starts a fresh fetch; same-user concurrent callers still
  // share one in-flight window as before (AC 5.10 spinner behaviour
  // stays correct). See bugbot thread on PR #37.
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
        // Drain the sync queue BEFORE fetching. Otherwise GET
        // /dashboard races any pending workout POST/PATCH/DELETE —
        // the server returns a `recentWorkouts` slice that doesn't
        // yet reflect the user's optimistic mutation, the cache
        // gets overwritten with the stale response, and the new
        // workout never appears on home until the next manual
        // refresh after the queue settles. Mirrors the same fix
        // applied to useWorkouts.refresh.
        try {
          await processSyncQueue(storage, auth, getApiBaseUrl());
        } catch (err) {
          // Per-entry errors are caught inside processSyncQueue;
          // an outer throw means a shell-level failure (e.g.
          // missing base URL). Log and proceed — refusing to
          // refresh is worse than fetching stale.
          console.error("[useDashboard] queue flush failed:", err);
        }
        if (latestUserIdRef.current !== userId) return;
        // Fetch first; DO NOT write to storage or state yet. If the
        // session flipped during the fetch, the writes below are
        // skipped — preventing cross-user state pollution + the
        // storage rewrite that would undo sign-out cleanup.
        const result = await api.getDashboard();
        if (!result.ok) {
          if (latestUserIdRef.current === userId) setError(result.error);
          return;
        }
        if (latestUserIdRef.current !== userId) return;
        storage.cacheDashboard(userId, result.value);
        setPayload(result.value);
        setIsStale(false);
        setSyncedAt(storage.getDashboardAge(userId));
        // Bump the version so any parent container re-running the
        // cache-read memo sees the updated row.
        setCacheVersion((v) => v + 1);
      } finally {
        setIsRefreshing(false);
        // Only clear if the registered entry is still for this user.
        // If user-2's refresh replaced ours during sign-out/sign-in,
        // the ref holds user-2's promise — skip the clear so user-2's
        // work isn't orphaned. `userId` here is the closure-captured
        // value from this `refresh` useCallback build, so comparing
        // to `inFlightRef.current.userId` correctly distinguishes
        // cross-user replacement.
        if (inFlightRef.current?.userId === userId) {
          inFlightRef.current = null;
        }
      }
    })();
    inFlightRef.current = { userId, promise: work };
    return work;
  }, [api, auth, storage, userId]);

  // One-shot auto-refresh per user when the cache is stale or empty.
  // The guard is keyed on `userId` — if the signed-in user changes
  // (sign-out → sign-in as a different user), re-arm the one-shot so
  // the new user's stale-cache auto-refresh can fire.
  //
  // Read `initial.isStale` directly, NOT the `isStale` state variable.
  // The state variable is initialised from `initial.isStale` but is only
  // re-synced via a separate useEffect, so it lags `initial` by one
  // render. During auth bootstrap (userId: null → "user-1") that lag
  // caused a spurious refresh every app open against a fresh cache:
  // the memo already knew the cache was fresh, but state was still
  // `true` from the null-user branch. See bugbot thread on PR #37.
  const autoRefreshedForUserRef = useRef<string | null>(null);
  const initialIsStale = initial.isStale;
  useEffect(() => {
    if (!userId) {
      autoRefreshedForUserRef.current = null;
      return;
    }
    if (autoRefreshedForUserRef.current === userId) return;
    if (!initialIsStale) return;
    autoRefreshedForUserRef.current = userId;
    void refresh();
  }, [userId, initialIsStale, refresh]);

  return {
    payload,
    isStale,
    isRefreshing,
    error,
    syncedAt,
    refresh,
  };
}
