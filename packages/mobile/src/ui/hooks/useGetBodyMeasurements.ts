import type { BodyTrendPoint } from "@/domain/models/progress";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Body-measurement trend for You/Progress sparklines (06-progress-goals, Phase
 * 06.7). Cache-first from `cached_body_trend` (where the optimistic weigh-in
 * appends), refreshes from `/body-trend?window=Nd`.
 */
export function useGetBodyMeasurements(
  windowDays = 30,
): CachedResourceState<BodyTrendPoint[]> {
  return useCachedResource<BodyTrendPoint[]>({
    read: (storage, userId) => ({
      value: storage.getCachedBodyTrend(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getBodyTrend(`${windowDays}d`),
    write: (storage, userId, value) => storage.cacheBodyTrend(userId, value),
  });
}
