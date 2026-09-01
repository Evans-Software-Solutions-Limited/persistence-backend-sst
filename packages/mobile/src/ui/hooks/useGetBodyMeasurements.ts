import type { BodyTrendPoint } from "@/domain/models/progress";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";
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
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const [data, setData] = useState<BodyTrendPoint[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const requestRevisionRef = useRef(0);

  const mergePending = useCallback(
    (server: BodyTrendPoint[] | null) => {
      if (!userId) return server ?? [];
      const merged = [...(server ?? [])];
      const pending = storage
        .getUncompletedMutations()
        .filter(
          (entry) =>
            entry.entityType === "measurement" &&
            entry.endpoint === "/measurements" &&
            entry.entityId !== null,
        );
      for (const entry of pending) {
        const date = entry.entityId;
        if (date === null) continue;
        let payload: {
          weightKg?: number;
          bodyFatPercentage?: number;
          measuredAt?: string;
        };
        try {
          payload = JSON.parse(entry.payload) as typeof payload;
        } catch {
          continue;
        }
        const optimistic: BodyTrendPoint = {
          date,
          measuredAt: payload.measuredAt,
          weightKg: payload.weightKg ?? null,
          bodyFat: payload.bodyFatPercentage ?? null,
        };
        const represented = merged.some(
          (point) =>
            payload.measuredAt !== undefined &&
            point.measuredAt === payload.measuredAt &&
            point.weightKg === optimistic.weightKg &&
            point.bodyFat === optimistic.bodyFat,
        );
        if (!represented) merged.push(optimistic);
      }
      return merged.sort((a, b) => a.date.localeCompare(b.date));
    },
    [storage, userId],
  );

  const load = useCallback(async () => {
    const revision = ++requestRevisionRef.current;
    setIsLoading(true);
    setData((current) => mergePending(current));
    const result = await api.getBodyTrend(`${windowDays}d`);
    if (requestRevisionRef.current !== revision) return;
    if (result.ok) {
      setData(mergePending(result.value));
      setError(null);
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  }, [api, mergePending, windowDays]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, isLoading, error, refresh: load };
}
