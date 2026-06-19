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
    // Shares the `personal_records` slot with the Home carousel — safe because
    // cachePersonalRecords upserts by (userId, exerciseId, recordType) (see
    // StoragePort), so the 5-PR Home window updates those keys without dropping
    // the deeper rows this 20-window wrote.
    write: (storage, userId, value) =>
      storage.cachePersonalRecords(userId, value),
  });
}
