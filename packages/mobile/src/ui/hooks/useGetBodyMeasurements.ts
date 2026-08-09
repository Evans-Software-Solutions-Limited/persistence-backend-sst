import type { BodyTrendPoint } from "@/domain/models/progress";
import { useCallback, useEffect, useState } from "react";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Body-measurement trend for You/Progress sparklines (06-progress-goals, Phase
 * 06.7). Cache-first from `cached_body_trend` (where the optimistic weigh-in
 * appends), refreshes from `/body-trend?window=Nd`.
 *
 * `enabled` (default `true`) gates the automatic fetch — pass a sheet/screen's
 * own open flag to defer the request until it's actually shown (launch
 * fan-out reduction; see `useCachedResource`'s `enabled` doc).
 */
export function useGetBodyMeasurements(
  windowDays = 30,
  enabled = true,
): CachedResourceState<BodyTrendPoint[]> {
  return useCachedResource<BodyTrendPoint[]>({
    read: (storage, userId) => ({
      value: storage.getCachedBodyTrend(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getBodyTrend(`${windowDays}d`),
    write: (storage, userId, value) => storage.cacheBodyTrend(userId, value),
    enabled,
  });
}

export type BodyMeasurementHistoryState = {
  data: BodyTrendPoint[] | null;
  isLoading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
};

/**
 * Network-only long-window history. It intentionally bypasses
 * `cached_body_trend`, whose 30-day payload is shared by You, Fuel Targets and
 * optimistic weigh-ins; caching a year here would corrupt those summaries.
 */
export function useGetBodyMeasurementHistory(
  windowDays = 366,
): BodyMeasurementHistoryState {
  const { api } = useAdapters();
  const [data, setData] = useState<BodyTrendPoint[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const result = await api.getBodyTrend(`${windowDays}d`);
    if (result.ok) {
      setData(result.value);
      setError(null);
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  }, [api, windowDays]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, isLoading, error, refresh: load };
}
