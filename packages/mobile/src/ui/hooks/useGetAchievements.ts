import type { Achievement } from "@/domain/models/achievement";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Unlocked achievements for the You/Progress milestones row + drawer count
 * (06-progress-goals, Phase 06.7). Cache-first from `cached_achievements`.
 *
 * `enabled` (default `true`) gates the automatic fetch — pass a sheet/screen's
 * own open flag to defer the request until it's actually shown (launch
 * fan-out reduction; see `useCachedResource`'s `enabled` doc).
 */
export function useGetAchievements(
  enabled = true,
): CachedResourceState<Achievement[]> {
  return useCachedResource<Achievement[]>({
    read: (storage, userId) => ({
      value: storage.getCachedAchievements(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getAchievements(),
    write: (storage, userId, value) => storage.cacheAchievements(userId, value),
    enabled,
  });
}
