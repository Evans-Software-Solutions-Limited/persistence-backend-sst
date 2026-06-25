import { useMemo } from "react";
import type { NutritionEntry } from "@/domain/models/nutrition";
import { flattenFuelEntries } from "@/domain/services/nutrition.service";
import type { ApiError } from "@/shared/errors";
import { useGetFuelToday } from "./useGetFuelToday";

export type NutritionEntriesState = {
  data: NutritionEntry[];
  isStale: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
};

/**
 * A day's logged entries (M9). DERIVED from `useGetFuelToday` so the entry
 * list and the macro ring share one source of truth — an optimistic log/edit/
 * delete updates both at once, with no second cache to drift.
 */
export function useGetNutritionEntries(date: string): NutritionEntriesState {
  const fuel = useGetFuelToday(date);
  const data = useMemo(
    () => (fuel.data ? flattenFuelEntries(fuel.data) : []),
    [fuel.data],
  );
  return {
    data,
    isStale: fuel.isStale,
    isRefreshing: fuel.isRefreshing,
    error: fuel.error,
    refresh: fuel.refresh,
  };
}
