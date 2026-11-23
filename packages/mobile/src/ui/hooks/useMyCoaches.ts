import { useEffect } from "react";
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
 * Every mounted `useMyCoaches` re-reads the cache through this, synchronously,
 * whenever any of them (or `notifyMyCoachesChanged`) writes it.
 *
 * The storage change bus is not enough on its own: it delivers on a debounced
 * timer (and not at all where the native listener is unavailable), so the tab
 * layout would still lack the Coach tab when the accept flow navigates to it,
 * and the stranded-route guard would bounce the athlete to Home (Inspector
 * Brad, #547). A synchronous re-read lands in the same React batch as the
 * navigation.
 */
const reloaders = new Set<() => void>();

/** Re-read `cached_my_coaches` in every mounted `useMyCoaches`, now. */
export function notifyMyCoachesChanged(): void {
  for (const reload of [...reloaders]) reload();
}

/**
 * PER-126 (APP-A3): the athlete's active coaches (`GET /users/me/coaching`),
 * cache-first from `cached_my_coaches` with a background refresh. Drives the
 * Coach tab (shown only while coached, one chip per coach) and You → Coaching.
 *
 * Reads the cache on every mount so the tab and list survive offline; always
 * refreshes once, because a coach can end coaching from their side at any
 * time. Writers outside this hook (leaving a coach) call
 * `notifyMyCoachesChanged` after writing the cache.
 */
export function useMyCoaches(opts?: { enabled?: boolean }): MyCoachesState {
  const res = useCachedResource<MyCoaching>({
    read: (storage, userId) => ({
      value: storage.getCachedMyCoaches(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getMyCoaching(),
    write: (storage, userId, value) => {
      storage.cacheMyCoaches(userId, value);
      notifyMyCoachesChanged();
    },
    tables: MY_COACHES_TABLES,
    enabled: opts?.enabled,
  });

  const reload = res.reload;
  useEffect(() => {
    reloaders.add(reload);
    return () => {
      reloaders.delete(reload);
    };
  }, [reload]);

  return { ...res, coaches: res.data?.coaches ?? NO_COACHES };
}
