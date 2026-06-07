import type { Rings } from "@/domain/models/progress";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Standalone Move/Train/Fuel rings (06-progress-goals, Phase 06.7). Seeds from
 * the cached Home payload's `rings` so it renders offline, then background-
 * refreshes from `/today-rings`. State-only (no dedicated cache slot — the Home
 * aggregate owns the persisted copy).
 */
export function useGetTodayRings(): CachedResourceState<Rings> {
  return useCachedResource<Rings>({
    read: (storage, userId) => ({
      value: storage.getCachedHome(userId)?.rings ?? null,
      isStale: true,
    }),
    fetcher: (api) => api.getTodayRings(),
    write: () => {},
  });
}
