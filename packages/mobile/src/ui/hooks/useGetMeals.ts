import type { Meal } from "@/domain/models/nutrition";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/** Cache-first read of the caller's saved meal presets (M9). */
export function useGetMeals(): CachedResourceState<Meal[]> {
  return useCachedResource<Meal[]>({
    read: (storage, userId) => ({
      value: storage.getCachedMeals(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getMeals(),
    write: (storage, userId, value) => storage.cacheMeals(userId, value),
  });
}
