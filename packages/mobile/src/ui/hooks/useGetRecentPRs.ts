import type { PersonalRecord } from "@/domain/models/record";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Recent PRs for the Home carousel (06-progress-goals, Phase 06.7). Cache-first
 * from the M3 `personal_records` cache, refreshes from `/users/me/prs`.
 */
export function useGetRecentPRs(
  limit = 5,
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
