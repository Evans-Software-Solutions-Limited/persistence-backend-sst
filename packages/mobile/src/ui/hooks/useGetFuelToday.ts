import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import type { FuelToday } from "@/domain/models/nutrition";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/** Day aggregate is considered stale after 5 minutes (FRONTEND_BRIEF). */
export const FUEL_TODAY_STALE_AFTER_MS = 5 * 60 * 1000;

export type FuelTodayState = {
  data: FuelToday | null;
  isStale: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  /** Network refresh: drain the queue, fetch server-truth, reconcile cache.
   *  `{ silent: true }` skips the `isRefreshing` toggle (background/focus). */
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  /**
   * Synchronous re-read of the local cache into state — no network. The Fuel
   * container calls this immediately after an optimistic mutation so the ring /
   * log reflect the recomputed aggregate even offline (where `refresh`'s fetch
   * can't land). `refresh` still runs after for server reconciliation online.
   */
  reload: () => void;
};

/**
 * Cache-first read of the Fuel-screen day aggregate (`GET /nutrition/today`).
 *
 * Bespoke (not `useCachedResource`) because the cache key includes `date`:
 * day-navigation happens WITHIN one mounted screen, so a generic hook keyed
 * only on `userId` would not re-read when the user pages to another day. This
 * keys the synchronous cache read + the background refresh on `(userId, date)`,
 * drains the sync queue before fetching (so optimistic writes land first), and
 * guards a user/date flip mid-flight so a stale payload can't pollute the cache.
 */
export function useGetFuelToday(date: string): FuelTodayState {
  const { api, auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const readCache = useCallback((): {
    value: FuelToday | null;
    stale: boolean;
  } => {
    if (!userId) return { value: null, stale: true };
    const value = storage.getCachedFuelToday(userId, date);
    const age = storage.getFuelTodayAge(userId, date);
    const stale =
      age === null || Date.now() - Date.parse(age) > FUEL_TODAY_STALE_AFTER_MS;
    return { value, stale };
  }, [storage, userId, date]);

  const [data, setData] = useState<FuelToday | null>(() => readCache().value);
  const [isStale, setIsStale] = useState<boolean>(() => readCache().stale);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Re-sync local state on a (userId, date) change.
  const keyRef = useRef(`${userId}:${date}`);
  useEffect(() => {
    const key = `${userId}:${date}`;
    if (keyRef.current === key) return;
    keyRef.current = key;
    const c = readCache();
    setData(c.value);
    setIsStale(c.stale);
  }, [userId, date, readCache]);

  const latestKeyRef = useRef(`${userId}:${date}`);
  useEffect(() => {
    latestKeyRef.current = `${userId}:${date}`;
  }, [userId, date]);

  const inFlightRef = useRef(false);
  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!userId || inFlightRef.current) return;
      const key = `${userId}:${date}`;
      inFlightRef.current = true;
      const showSpinner = !opts?.silent;
      if (showSpinner) setIsRefreshing(true);
      setError(null);
      try {
        try {
          await processSyncQueue(storage, auth, getApiBaseUrl());
        } catch (err) {
          console.error("[useGetFuelToday] queue flush failed:", err);
        }
        if (latestKeyRef.current !== key) return;
        const result = await api.getFuelToday(date);
        if (!result.ok) {
          if (latestKeyRef.current === key) setError(result.error);
          return;
        }
        if (latestKeyRef.current !== key) return;
        storage.cacheFuelToday(userId, date, result.value);
        // Mirror the target into its own cache so the Targets editor reads it
        // offline even if the user never opened that screen online.
        if (result.value.targets) {
          storage.cacheNutritionTarget(userId, result.value.targets);
        }
        setData(result.value);
        setIsStale(false);
      } finally {
        if (showSpinner) setIsRefreshing(false);
        inFlightRef.current = false;
      }
    },
    [api, auth, storage, userId, date],
  );

  const autoRefreshedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) {
      autoRefreshedRef.current = null;
      return;
    }
    const key = `${userId}:${date}`;
    if (autoRefreshedRef.current === key) return;
    if (!readCache().stale) return;
    autoRefreshedRef.current = key;
    void refresh();
  }, [userId, date, readCache, refresh]);

  const reload = useCallback(() => {
    const c = readCache();
    setData(c.value);
    setIsStale(c.stale);
  }, [readCache]);

  return { data, isStale, isRefreshing, error, refresh, reload };
}
