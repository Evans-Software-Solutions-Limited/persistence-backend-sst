import type { Recipe } from "@/domain/models/nutrition";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Cache-first read of a single recipe with its ingredients (M9). Keyed by `id`
 * — the recipe-detail route mounts fresh per id, so capturing `id` in the read
 * closure is safe (no in-screen key change, unlike the Fuel day aggregate).
 */
export function useGetRecipe(id: string): CachedResourceState<Recipe | null> {
  return useCachedResource<Recipe | null>({
    read: (storage, userId) => ({
      value: storage.getCachedRecipe(userId, id),
      isStale: true,
    }),
    fetcher: (api) => api.getRecipe(id),
    write: (storage, userId, value) => {
      if (value) storage.cacheRecipe(userId, value);
    },
  });
}
