import { MEAL_PLAN_TABLES } from "@/adapters/storage/tables";
import type { MealPlan } from "@/domain/models/mealprint";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Cache-first read of the ACTIVE Mealprint plan for one date
 * (`GET /nutrition/plans/active?date=`, spec-26 Phase 2, AC 5.1/5.3).
 *
 * Mirrors `useGetFuelToday`: cache read is synchronous and offline-safe, the
 * `enabled` gate gets an automatic fetch on top (default `true` — the Fuel tab
 * needs this on every mount to know whether to render ghost rows / the
 * ACTIVE entry-card state, unlike the launch-fan-out-sensitive Mealprint
 * SHEETS, which pass their own open flag into `useMealprintPreferences`).
 *
 * ⚠ **A `null` result is cached explicitly.** `read`'s `getCachedActiveMealPlan`
 * returning `null` covers BOTH "never fetched" and "fetched, no plan today" —
 * this hook does not need to distinguish them the way
 * `useMealprintPreferences` distinguishes "unknown" from "isDefault", because
 * there is no first-run branch hanging off this one: the Fuel card's
 * `!hasActivePlan` state is simply correct either way (offer to plan; don't
 * offer to plan a day already planned).
 */
export function useGetActiveMealPlan(
  date: string,
  enabled = true,
): CachedResourceState<MealPlan | null> {
  return useCachedResource<MealPlan | null>({
    read: (storage, userId) => ({
      value: storage.getCachedActiveMealPlan(userId, date),
      isStale: true,
    }),
    fetcher: (api) => api.getActivePlan(date),
    write: (storage, userId, value) => {
      if (value === null) {
        storage.removeCachedMealPlan(userId, date);
      } else {
        storage.cacheMealPlan(userId, value);
      }
    },
    tables: MEAL_PLAN_TABLES,
    enabled,
  });
}
