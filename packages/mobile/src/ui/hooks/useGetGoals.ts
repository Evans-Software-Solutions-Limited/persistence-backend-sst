import { ok } from "@/shared/errors";
import {
  areGoalsStale,
  mapApiGoalToGoal,
  type Goal,
} from "@/domain/models/goal";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Cache-first athlete goals list (M16 — Athlete Training page). Backs the Train
 * overview's Goals section: reads the cached `Goal[]` instantly (offline-safe),
 * refreshes from `GET /goals` when empty/stale (5-min TTL). The enriched wire
 * row (goal-type name/icon + coach attribution) is mapped to the domain `Goal`
 * on fetch, and the optimistic CRUD commands write the same cache so `reload()`
 * reflects mutations before the network reconciles.
 */
export function useGetGoals(): CachedResourceState<Goal[]> {
  return useCachedResource<Goal[]>({
    read: (storage, userId) => ({
      value: storage.getCachedGoals(userId),
      isStale: areGoalsStale(storage.getGoalsAge(userId), Date.now()),
    }),
    fetcher: async (api) => {
      const result = await api.getGoals();
      return result.ok ? ok(result.value.map(mapApiGoalToGoal)) : result;
    },
    write: (storage, userId, value) => storage.cacheGoals(userId, value),
  });
}
