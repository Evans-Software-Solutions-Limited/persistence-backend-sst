import { isHomeStale, type HomePayload } from "@/domain/models/progress";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Cache-first Home aggregate (06-progress-goals, Phase 06.7). Backs the Home
 * cold-start render — rings, micro-pills, weekly volume, recent PRs, habits in
 * one read. 5-min TTL via `getHomeAge`.
 */
export function useGetHome(): CachedResourceState<HomePayload> {
  return useCachedResource<HomePayload>({
    read: (storage, userId) => ({
      value: storage.getCachedHome(userId),
      isStale: isHomeStale(storage.getHomeAge(userId), Date.now()),
    }),
    fetcher: (api) => api.getHome(),
    write: (storage, userId, value) => storage.cacheHome(userId, value),
  });
}
