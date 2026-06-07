import type { VolumeStats } from "@/domain/models/progress";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * You/Progress volume stats (06-progress-goals, Phase 06.7). Cache-first from
 * `cached_volume_stats`, refreshes from `/volume-stats?window=`.
 */
export function useGetVolumeStats(
  window = "month",
): CachedResourceState<VolumeStats> {
  return useCachedResource<VolumeStats>({
    read: (storage, userId) => ({
      value: storage.getCachedVolumeStats(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getVolumeStats(window),
    write: (storage, userId, value) => storage.cacheVolumeStats(userId, value),
  });
}
