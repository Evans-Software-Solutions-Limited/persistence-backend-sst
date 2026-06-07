import type { WeeklyVolume } from "@/domain/models/progress";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Weekly-volume bar chart (06-progress-goals, Phase 06.7). Seeds from the
 * cached Home payload's `weeklyVolume`, refreshes from `/weekly-volume`.
 */
export function useGetWeeklyVolume(): CachedResourceState<WeeklyVolume> {
  return useCachedResource<WeeklyVolume>({
    read: (storage, userId) => ({
      value: storage.getCachedHome(userId)?.weeklyVolume ?? null,
      isStale: true,
    }),
    fetcher: (api) => api.getWeeklyVolume("7d"),
    write: () => {},
  });
}
