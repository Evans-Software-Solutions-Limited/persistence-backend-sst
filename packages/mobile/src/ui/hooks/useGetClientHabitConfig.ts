import { useCallback, useEffect, useState } from "react";
import {
  habitConfigFromEntry,
  mergeHabitConfigs,
  type HabitConfig,
} from "@/domain/models/habit-config";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";

/**
 * A coach reads a client's habit config (18-habit-setup § 3.2, coach view).
 * Direct read (no local cache — the coach device doesn't own the client's
 * data), refreshed on demand; mirrors ClientDetailContainer's active-programme
 * fetch. Returns all five categories merged (disabled default when unset).
 */
export function useGetClientHabitConfig(clientId: string | undefined): {
  configs: HabitConfig[];
  isLoading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
} {
  const { api } = useAdapters();
  const [configs, setConfigs] = useState<HabitConfig[]>(() =>
    mergeHabitConfigs([]),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    if (!clientId) return;
    setIsLoading(true);
    setError(null);
    const result = await api.getClientHabitConfigs(clientId);
    if (result.ok) {
      const mapped = result.value
        .map(habitConfigFromEntry)
        .filter((c): c is HabitConfig => c !== null);
      setConfigs(mergeHabitConfigs(mapped));
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  }, [api, clientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { configs, isLoading, error, refresh };
}
