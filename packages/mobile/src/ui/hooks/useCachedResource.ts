import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import type { Result, ApiError } from "@/shared/errors";
import type { StoragePort } from "@/domain/ports/storage.port";
import type { ApiPort } from "@/domain/ports/api.port";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Generic cache-first read hook (06-progress-goals, Phase 06.7). Distils the
 * offline-first pattern proven by `useDashboard` so the dozen Progress/Home
 * read hooks don't each re-implement it:
 *
 *  - synchronous cache read on mount (renders instantly, offline);
 *  - one-shot background refresh per user when the cache is empty/stale;
 *  - `refresh()` drains the sync queue first (so optimistic mutations land
 *    before the GET), then fetches; a session flip mid-flight is guarded so a
 *    stale user's payload can't pollute another user's cache;
 *  - failure leaves the cached value intact and surfaces `error`.
 *
 * `read` returns the cached value + staleness; `fetcher` hits the API; `write`
 * persists a successful fetch (pass a no-op to skip caching).
 */
export type CachedResourceConfig<T> = {
  read: (
    storage: StoragePort,
    userId: string,
  ) => { value: T | null; isStale: boolean };
  fetcher: (api: ApiPort) => Promise<Result<T, ApiError>>;
  write: (storage: StoragePort, userId: string, value: T) => void;
};

export type CachedResourceState<T> = {
  data: T | null;
  isStale: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
};

export function useCachedResource<T>(
  config: CachedResourceConfig<T>,
): CachedResourceState<T> {
  const { api, auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const { read, fetcher, write } = config;

  const [cacheVersion, setCacheVersion] = useState(0);
  const initial = useMemo(() => {
    void cacheVersion;
    if (!userId) return { value: null as T | null, isStale: true };
    const r = read(storage, userId);
    return { value: r.value, isStale: r.isStale };
    // `read` is a stable closure from the caller; userId/cacheVersion drive it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, userId, cacheVersion]);

  const [data, setData] = useState<T | null>(initial.value);
  const [isStale, setIsStale] = useState(initial.isStale);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Re-sync local state when the signed-in user changes.
  const prevUserRef = useRef<string | null>(userId);
  useEffect(() => {
    if (prevUserRef.current === userId) return;
    prevUserRef.current = userId;
    setData(initial.value);
    setIsStale(initial.isStale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const latestUserRef = useRef<string | null>(userId);
  useEffect(() => {
    latestUserRef.current = userId;
  }, [userId]);

  const inFlightRef = useRef(false);
  const refresh = useCallback(async () => {
    if (!userId || inFlightRef.current) return;
    inFlightRef.current = true;
    setIsRefreshing(true);
    setError(null);
    try {
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useCachedResource] queue flush failed:", err);
      }
      if (latestUserRef.current !== userId) return;
      const result = await fetcher(api);
      if (!result.ok) {
        if (latestUserRef.current === userId) setError(result.error);
        return;
      }
      if (latestUserRef.current !== userId) return;
      write(storage, userId, result.value);
      setData(result.value);
      setIsStale(false);
      setCacheVersion((v) => v + 1);
    } finally {
      setIsRefreshing(false);
      inFlightRef.current = false;
    }
    // read/fetcher/write are stable caller closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, auth, storage, userId]);

  const autoRefreshedRef = useRef<string | null>(null);
  const initialIsStale = initial.isStale;
  useEffect(() => {
    if (!userId) {
      autoRefreshedRef.current = null;
      return;
    }
    if (autoRefreshedRef.current === userId) return;
    if (!initialIsStale) return;
    autoRefreshedRef.current = userId;
    void refresh();
  }, [userId, initialIsStale, refresh]);

  return { data, isStale, isRefreshing, error, refresh };
}
