import type { Recipe } from "@/domain/models/nutrition";
import { RECIPE_TABLES } from "@/adapters/storage";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Cache-first read of the caller's recipe library (M9). The list payload omits
 * ingredients (cards show name + totals); the detail hook fills them in.
 *
 * `enabled` (default `true`) gates the automatic fetch — pass a sheet/screen's
 * own open flag to defer the request until it's actually shown (launch
 * fan-out reduction; see `useCachedResource`'s `enabled` doc).
 */
export function useGetRecipes(enabled = true): CachedResourceState<Recipe[]> {
  return useCachedResource<Recipe[]>({
    read: (storage, userId) => ({
      value: storage.getCachedRecipes(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getRecipes(),
    write: (storage, userId, value) => storage.cacheRecipes(userId, value),
    tables: RECIPE_TABLES,
    enabled,
  });
}
