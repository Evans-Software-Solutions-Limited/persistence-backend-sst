import type { Streak } from "@/domain/models/streak";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Active streak rows for the You/Progress StreakHero (06-progress-goals, Phase
 * 06.10). Cache-first from `cached_streaks` (which useUseFreezeToken also
 * updates on a manual spend).
 */
export function useGetStreaks(): CachedResourceState<Streak[]> {
  return useCachedResource<Streak[]>({
    read: (storage, userId) => ({
      value: storage.getCachedStreaks(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getStreaks(),
    write: (storage, userId, value) => storage.cacheStreaks(userId, value),
  });
}
