import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import type { Result, ApiError } from "@/shared/errors";
import type { StoragePort } from "@/domain/ports/storage.port";
import type { ApiPort } from "@/domain/ports/api.port";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Cold-start retry cadence (ms to wait BEFORE each attempt). A fresh-cache first
 * load — brand-new account, or an existing account on a new device — has no
 * cached value to fall back on, so a single failed fetch strands the user on the
 * error screen (a warm device silently shows its stale cache instead). The very
 * first backend request after idle can also hit a cold Lambda that exceeds the
 * per-request 10s timeout (`DASHBOARD_REQUEST_TIMEOUT_MS`); attempts 2 and 3
 * land after it has warmed. Only used when the cache is empty AND the failure is
 * transient (see `isRetryableColdStartError`).
 */
export const COLD_START_RETRY_DELAYS_MS = [0, 1500, 4000];

/**
 * Transient failures worth retrying on a cold start: a timed-out request (cold
 * Lambda), a network blip, or a server 5xx. A 4xx (unauthorized, not-found,
 * entitlement-denied) does NOT self-heal — retrying would only delay the correct
 * error state — so those surface immediately.
 */
function isRetryableColdStartError(error: ApiError): boolean {
  return (
    error.code === "timeout" ||
    error.code === "network" ||
    error.code === "server"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generic cache-first read hook (06-progress-goals, Phase 06.7). Distils the
 * offline-first pattern proven by `useDashboard` so the dozen Progress/Home
 * read hooks don't each re-implement it:
 *
 *  - synchronous cache read on mount (renders instantly, offline);
 *  - background refresh per user when the cache is empty/stale — retried with
 *    backoff on a cold start (empty cache) so a slow/cold first request doesn't
 *    strand a brand-new user on the error screen (`COLD_START_RETRY_DELAYS_MS`);
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
  /**
   * Synchronous cache re-read: re-runs `read` and pushes the result into local
   * state, with NO network call. This is the reactive bridge for optimistic
   * mutations — a command writes to the cache and returns void, so without this
   * the mounted component's `data` snapshot stays stale until a re-mount or a
   * successful `refresh` (the habit-grid-toggle bug). Call `reload()` right
   * after an optimistic write to reflect it instantly, offline-safe; `refresh`
   * still reconciles with server truth afterward. Mirrors `useGetFuelToday`.
   */
  reload: () => void;
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

  // One fetch pass: drain the sync queue, GET, and write-through on success.
  // Returns the `ApiError` on failure (or null on success / a session flip
  // mid-flight). Deliberately does NOT touch `error`, `isRefreshing`, or
  // `inFlightRef` — the caller owns that lifecycle, so the cold-start path can
  // retry across attempts without flashing the error state between them.
  const attemptFetch = useCallback(async (): Promise<ApiError | null> => {
    try {
      await processSyncQueue(storage, auth, getApiBaseUrl());
    } catch (err) {
      console.error("[useCachedResource] queue flush failed:", err);
    }
    if (userId == null || latestUserRef.current !== userId) return null;
    const result = await fetcher(api);
    if (!result.ok) {
      return latestUserRef.current === userId ? result.error : null;
    }
    if (latestUserRef.current !== userId) return null;
    write(storage, userId, result.value);
    setData(result.value);
    setIsStale(false);
    setCacheVersion((v) => v + 1);
    return null;
    // read/fetcher/write are stable caller closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, auth, storage, userId]);

  const refresh = useCallback(async () => {
    if (!userId || inFlightRef.current) return;
    inFlightRef.current = true;
    setIsRefreshing(true);
    setError(null);
    try {
      const err = await attemptFetch();
      if (err && latestUserRef.current === userId) setError(err);
    } finally {
      setIsRefreshing(false);
      inFlightRef.current = false;
    }
  }, [userId, attemptFetch]);

  const reload = useCallback(() => {
    if (!userId) return;
    const r = read(storage, userId);
    setData(r.value);
    setIsStale(r.isStale);
    // `read` is a stable caller closure (same convention as `refresh`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, userId]);

  const autoRefreshedRef = useRef<string | null>(null);
  const initialIsStale = initial.isStale;
  const initialHasNoCache = initial.value == null;
  useEffect(() => {
    if (!userId) {
      autoRefreshedRef.current = null;
      return;
    }
    if (autoRefreshedRef.current === userId) return;
    if (!initialIsStale) return;
    if (inFlightRef.current) return;
    autoRefreshedRef.current = userId;

    // Retry with backoff ONLY on a cold start (no cached value to fall back on).
    // With a stale-but-present cache, one attempt is enough — the stale data
    // already renders, so a failed refresh is invisible and needn't retry.
    const delays = initialHasNoCache ? COLD_START_RETRY_DELAYS_MS : [0];

    let cancelled = false;
    inFlightRef.current = true;
    setIsRefreshing(true);
    setError(null);

    void (async () => {
      try {
        let lastError: ApiError | null = null;
        for (let attempt = 0; attempt < delays.length; attempt++) {
          if (cancelled || latestUserRef.current !== userId) break;
          if (delays[attempt] > 0) {
            await sleep(delays[attempt]);
            if (cancelled || latestUserRef.current !== userId) break;
          }
          // Even if `attemptFetch` THROWS (fetcher rejects, or
          // processSyncQueue rethrows past its own try/catch), the
          // `finally` below still releases `inFlightRef` — otherwise a
          // thrown rejection here would leave `inFlightRef.current` stuck
          // `true` forever, and `refresh()`'s `if (inFlightRef.current)
          // return` would silently no-op on every future call until an
          // app restart (QA-14a).
          lastError = await attemptFetch();
          if (!lastError) break; // success — attemptFetch already wrote `data`
          if (!isRetryableColdStartError(lastError)) break; // 4xx: don't retry
        }
        if (!cancelled && lastError && latestUserRef.current === userId) {
          setError(lastError);
        }
      } catch (err) {
        // `attemptFetch` isn't supposed to throw (it returns the ApiError
        // on failure), but a misbehaving `fetcher` rejecting instead of
        // resolving a `Result` must not escape as an unhandled rejection
        // off this void-called IIFE — log and fall through to `finally`.
        console.error("[useCachedResource] mount auto-refresh failed:", err);
      } finally {
        if (!cancelled) setIsRefreshing(false);
        inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
    // attemptFetch is stable per (api/auth/storage/userId); initial* gate entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, initialIsStale, initialHasNoCache, attemptFetch]);

  return { data, isStale, isRefreshing, error, refresh, reload };
}
