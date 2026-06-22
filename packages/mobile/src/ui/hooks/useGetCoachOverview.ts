import type { CoachOverview } from "@/domain/models/coachOverview";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/** Cache is considered stale after 5 minutes (matches the dashboard TTL). */
export const COACH_OVERVIEW_STALE_AFTER_MS = 5 * 60 * 1000;

export function isCoachOverviewStale(
  syncedAt: string | null,
  now: number,
): boolean {
  if (syncedAt === null) return true;
  const ts = new Date(syncedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return now - ts > COACH_OVERVIEW_STALE_AFTER_MS;
}

/**
 * Coach You overview (10-trainer-features). Cache-first from
 * `cached_coach_overview`, refreshes from `GET /trainers/me/overview`.
 * Mirrors `useGetStreaks` / `useDashboard` — renders the cached snapshot
 * instantly (offline-friendly) then background-refreshes when stale.
 */
export function useGetCoachOverview(): CachedResourceState<CoachOverview> {
  return useCachedResource<CoachOverview>({
    read: (storage, userId) => ({
      value: storage.getCachedCoachOverview(userId),
      isStale: isCoachOverviewStale(
        storage.getCoachOverviewAge(userId),
        Date.now(),
      ),
    }),
    fetcher: (api) => api.getCoachOverview(),
    write: (storage, userId, value) =>
      storage.cacheCoachOverview(userId, value),
  });
}
