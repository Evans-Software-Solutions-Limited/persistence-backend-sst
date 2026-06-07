import type { PersonalRecord } from "@/domain/models/record";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * PR history for You/Progress (06-progress-goals, Phase 06.7). Same source as
 * the Home carousel but a deeper limit (20).
 */
export function useGetPRHistory(
  limit = 20,
): CachedResourceState<PersonalRecord[]> {
  return useCachedResource<PersonalRecord[]>({
    read: (storage, userId) => ({
      value: storage.getPersonalRecords(userId).slice(0, limit),
      isStale: true,
    }),
    fetcher: (api) => api.getRecentPRs(limit),
    write: (storage, userId, value) =>
      storage.cachePersonalRecords(userId, value),
  });
}
