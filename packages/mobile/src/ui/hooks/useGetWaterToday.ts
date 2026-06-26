import { useMemo } from "react";
import type { WaterToday } from "@/domain/models/nutrition";
import type { ApiError } from "@/shared/errors";
import { useGetFuelToday } from "./useGetFuelToday";

export type WaterTodayState = {
  data: WaterToday | null;
  isStale: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
};

/**
 * A day's water progress (M9). DERIVED from `useGetFuelToday` (`consumed.
 * waterCups` + `targets.waterCups`, default goal 8) so the water tracker and
 * the rest of the screen stay in lockstep through optimistic +/- taps.
 */
export function useGetWaterToday(date: string): WaterTodayState {
  const fuel = useGetFuelToday(date);
  const data = useMemo<WaterToday | null>(() => {
    if (!fuel.data) return null;
    return {
      cups: fuel.data.consumed.waterCups,
      goal: fuel.data.targets?.waterCups ?? 8,
    };
  }, [fuel.data]);
  return {
    data,
    isStale: fuel.isStale,
    isRefreshing: fuel.isRefreshing,
    error: fuel.error,
    refresh: fuel.refresh,
  };
}
