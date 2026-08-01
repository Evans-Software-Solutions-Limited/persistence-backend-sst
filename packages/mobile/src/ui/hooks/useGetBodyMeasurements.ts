import type { BodyTrendPoint } from "@/domain/models/progress";
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
