import type { Meal } from "@/domain/models/nutrition";
import { MEAL_TABLES } from "@/adapters/storage";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Cache-first read of the caller's saved meal presets (M9).
 *
 * `enabled` (default `true`) gates the automatic fetch — pass a sheet/screen's
 * own open flag to defer the request until it's actually shown (launch
 * fan-out reduction; see `useCachedResource`'s `enabled` doc).
 */
export function useGetMeals(enabled = true): CachedResourceState<Meal[]> {
  return useCachedResource<Meal[]>({
    read: (storage, userId) => ({
      value: storage.getCachedMeals(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getMeals(),
    write: (storage, userId, value) => storage.cacheMeals(userId, value),
    tables: MEAL_TABLES,
    enabled,
  });
}
