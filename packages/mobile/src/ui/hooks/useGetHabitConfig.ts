import { useMemo } from "react";
import {
  habitConfigFromEntry,
  mergeHabitConfigs,
  type HabitConfig,
} from "@/domain/models/habit-config";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * Habit config for the setup screen (18-habit-setup, Phase 18.7 — T-18.7.5).
 * Cache-first + background refresh (STORY-001 AC 1.4 / STORY-009 AC 9.1). The
 * cached rows are merged with the fixed five categories so the screen always
 * renders all five (disabled default when the server has no row yet).
 *
 * SELF only — the coach view (a client's config) is a direct read via
 * `useGetClientHabitConfig` (the coach device doesn't cache the client's data).
 */
export type HabitConfigState = CachedResourceState<HabitConfig[]> & {
  /** All five categories in HABIT_ORDER, cached row or disabled default. */
  configs: HabitConfig[];
};

export function useGetHabitConfig(): HabitConfigState {
  const res = useCachedResource<HabitConfig[]>({
    read: (storage, userId) => ({
      value: storage.getHabitConfigs(userId),
      // Always background-refresh once: the config is small + rarely changes,
      // but a coach edit or a promoted pending needs to land.
      isStale: true,
    }),
    fetcher: async (api) => {
      const result = await api.getHabitConfigs();
      if (!result.ok) return result;
      const mapped = result.value
        .map(habitConfigFromEntry)
        .filter((c): c is HabitConfig => c !== null);
      return { ok: true, value: mapped };
    },
    write: (storage, userId, value) => storage.cacheHabitConfigs(userId, value),
  });

  const configs = useMemo(() => mergeHabitConfigs(res.data ?? []), [res.data]);

  return { ...res, configs };
}
