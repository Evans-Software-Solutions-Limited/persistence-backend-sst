import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getDashboardQuery,
  refreshDashboard,
} from "@/application/queries/dashboard.query";
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
  const { api, storage } = useAdapters();
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

  const refresh = useCallback(async () => {
    if (!userId) return;
    setIsRefreshing(true);
    setError(null);
    try {
      const result = await refreshDashboard(api, storage, userId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPayload(result.value);
      setIsStale(false);
      setSyncedAt(storage.getDashboardAge(userId));
      // Bump the version so any parent container re-running the
      // cache-read memo sees the updated row.
      setCacheVersion((v) => v + 1);
    } finally {
      setIsRefreshing(false);
    }
  }, [api, storage, userId]);

  // One-shot auto-refresh per user when the cache is stale or empty.
  // The guard is keyed on `userId` — if the signed-in user changes
  // (sign-out → sign-in as a different user), re-arm the one-shot so
  // the new user's stale-cache auto-refresh can fire. Without this
  // reset the Home tab sat empty on user-switch until a manual pull-
  // to-refresh. See bugbot thread on PR #37.
  const autoRefreshedForUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) {
      autoRefreshedForUserRef.current = null;
      return;
    }
    if (autoRefreshedForUserRef.current === userId) return;
    if (!isStale) return;
    autoRefreshedForUserRef.current = userId;
    void refresh();
  }, [userId, isStale, refresh]);

  return {
    payload,
    isStale,
    isRefreshing,
    error,
    syncedAt,
    refresh,
  };
}
