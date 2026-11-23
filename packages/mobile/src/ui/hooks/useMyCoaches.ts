import { MY_COACHES_TABLES } from "@/adapters/storage/tables";
import type { MyCoach, MyCoaching } from "@/domain/models/myCoaching";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

export type MyCoachesState = CachedResourceState<MyCoaching> & {
  /** The athlete's active coaches, oldest relationship first; [] until read. */
  coaches: MyCoach[];
};

const NO_COACHES: MyCoach[] = [];

/**
 * PER-126 (APP-A3): the athlete's active coaches (`GET /users/me/coaching`),
 * cache-first from `cached_my_coaches` with a background refresh. Drives the
 * Coach tab (shown only while coached, one chip per coach) and You → Coaching.
 *
 * Reads the cache on every mount so the tab and list survive offline; always
 * refreshes once, because a coach can end coaching from their side at any
 * time. Subscribes to the table, so leaving a coach (which drops them from
 * the cache) removes their chip without a refetch.
 */
export function useMyCoaches(opts?: { enabled?: boolean }): MyCoachesState {
  const res = useCachedResource<MyCoaching>({
    read: (storage, userId) => ({
      value: storage.getCachedMyCoaches(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getMyCoaching(),
    write: (storage, userId, value) => storage.cacheMyCoaches(userId, value),
    tables: MY_COACHES_TABLES,
    enabled: opts?.enabled,
  });
  return { ...res, coaches: res.data?.coaches ?? NO_COACHES };
}
