import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProfilePageQuery } from "@/application/queries/profile-page.query";
import type { ProfilePageData } from "@/domain/models/profilePage";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * React hook exposing the profile-page cache to the Profile tab.
 *
 * Behaviour mirrors `useDashboard`:
 * - Reads synchronously from StoragePort on mount (cache-first).
 * - If the cache is empty or stale, fires a background refresh exactly
 *   once per (user, mount).
 * - `refresh()` always re-fetches, bypassing the TTL (pull-to-refresh).
 * - Failure leaves the cached payload intact; `error` surfaces so the
 *   UI can render a non-blocking indicator.
 * - Same-user concurrent `refresh()` callers share one in-flight
 *   promise; cross-user refreshes start a fresh fetch.
 *
 * Spec: specs/milestones/M6-profile/BACKEND_BRIEF.md
 */

export type ProfilePageState = {
  payload: ProfilePageData | null;
  isStale: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  syncedAt: string | null;
  refresh: () => Promise<void>;
};

export function useProfilePage(): ProfilePageState {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const [cacheVersion, setCacheVersion] = useState(0);

  const initial = useMemo(() => {
    void cacheVersion;
    if (!userId) {
      return { payload: null, isStale: true, syncedAt: null as string | null };
    }
    const { payload, isStale, cached } = getProfilePageQuery(storage, userId);
    return {
      payload,
      isStale,
      syncedAt: cached?.syncedAt ?? null,
    };
  }, [storage, userId, cacheVersion]);

  const [payload, setPayload] = useState<ProfilePageData | null>(
    initial.payload,
  );
  const [isStale, setIsStale] = useState(initial.isStale);
  const [syncedAt, setSyncedAt] = useState<string | null>(initial.syncedAt);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const previousUserIdRef = useRef<string | null>(userId);
  useEffect(() => {
    if (previousUserIdRef.current === userId) return;
    previousUserIdRef.current = userId;
    setPayload(initial.payload);
    setIsStale(initial.isStale);
    setSyncedAt(initial.syncedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
        if (latestUserIdRef.current !== userId) return;
        const result = await api.getProfilePage();
        if (!result.ok) {
          if (latestUserIdRef.current === userId) setError(result.error);
          return;
        }
        if (latestUserIdRef.current !== userId) return;
        storage.cacheProfilePage(userId, result.value);
        setPayload(result.value);
        setIsStale(false);
        setSyncedAt(storage.getProfilePageAge(userId));
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
