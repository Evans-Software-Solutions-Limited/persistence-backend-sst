import type { NutritionTarget } from "@/domain/models/nutrition";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Cache-first read of the caller's daily target (M9). `null` when never set
 * (the Targets editor renders the "set your targets" empty state). Refreshes
 * once per user from `cached_nutrition_target`.
 */
export function useGetNutritionTarget(): CachedResourceState<NutritionTarget | null> {
  return useCachedResource<NutritionTarget | null>({
    read: (storage, userId) => ({
      value: storage.getCachedNutritionTarget(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getNutritionTarget(),
    write: (storage, userId, value) => {
      if (value) storage.cacheNutritionTarget(userId, value);
    },
  });
}
