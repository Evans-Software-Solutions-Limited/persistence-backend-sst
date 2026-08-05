import type { NutritionTarget } from "@/domain/models/nutrition";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Cache-first read of the caller's daily target (M9). `null` when never set
 * (the Targets editor renders the "set your targets" empty state). Refreshes
 * once per user from `cached_nutrition_target`.
 *
 * `enabled` (default `true`, preserving every existing caller's behaviour)
 * gates the AUTOMATIC fetch — see `useCachedResource`'s docstring on why this
 * matters for a root-mounted sheet: `MealprintPlanSheetContainer` passes its
 * own `visible` so the config stage's "your day's target" read doesn't fire on
 * every cold launch (the launch-fan-out fix `useMealprintPreferences` already
 * applies for the same reason).
 */
export function useGetNutritionTarget(
  enabled = true,
): CachedResourceState<NutritionTarget | null> {
  return useCachedResource<NutritionTarget | null>({
    read: (storage, userId) => ({
      value: storage.getCachedNutritionTarget(userId),
      isStale: true,
    }),
    fetcher: (api) => api.getNutritionTarget(),
    write: (storage, userId, value) => {
      if (value) storage.cacheNutritionTarget(userId, value);
    },
    enabled,
  });
}
