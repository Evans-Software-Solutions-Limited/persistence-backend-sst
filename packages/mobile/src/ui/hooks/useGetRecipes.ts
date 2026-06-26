import type { Recipe } from "@/domain/models/nutrition";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Cache-first read of the caller's recipe library (M9). The list payload omits
 * ingredients (cards show name + totals); the detail hook fills them in.
 */
export function useGetRecipes(): CachedResourceState<Recipe[]> {
  return useCachedResource<Recipe[]>({
    read: (storage, userId) => ({
      value: storage.getCachedRecipes(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getRecipes(),
    write: (storage, userId, value) => storage.cacheRecipes(userId, value),
  });
}
