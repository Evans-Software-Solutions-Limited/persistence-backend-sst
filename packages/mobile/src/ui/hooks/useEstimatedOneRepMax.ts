import { useCallback, useEffect, useRef, useState } from "react";
import type { EstimatedOneRepMax } from "@/domain/models/exercisePerformance";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/** Stable cache-key contract shared with future persistent storage/query clients. */
export const estimatedOneRepMaxKey = (userId: string, exerciseId: string) =>
  ["estimated-one-rep-max", userId, exerciseId] as const;

// Small process cache makes repeated detail opens cache-first and, critically,
// scopes values by BOTH authenticated user and exercise. The port key above is
// deliberately storage-agnostic so this can move to SQLite without changing UI.
const cache = new Map<string, EstimatedOneRepMax | null>();
const cacheId = (userId: string, exerciseId: string) =>
  `${userId}:${exerciseId}`;

export function useEstimatedOneRepMax(
  exerciseId: string | null,
  enabled = true,
): {
  data: EstimatedOneRepMax | null;
  isLoading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
} {
  const { api } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const key =
    enabled && userId && exerciseId ? cacheId(userId, exerciseId) : null;
  const activeKeyRef = useRef(key);
  activeKeyRef.current = key;
  const [data, setData] = useState<EstimatedOneRepMax | null>(() =>
    key && cache.has(key) ? (cache.get(key) ?? null) : null,
  );
  const [isLoading, setIsLoading] = useState(key != null && !cache.has(key));
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    if (!key || !exerciseId) return;
    const requestKey = key;
    setIsLoading(true);
    const result = await api.getEstimatedOneRepMax(exerciseId);
    if (result.ok) {
      cache.set(requestKey, result.value);
      if (activeKeyRef.current !== requestKey) return;
      setData(result.value);
      setError(null);
    } else {
      if (activeKeyRef.current !== requestKey) return;
      setError(result.error);
    }
    if (activeKeyRef.current === requestKey) setIsLoading(false);
  }, [api, exerciseId, key]);

  useEffect(() => {
    if (!key) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    const hasCachedValue = cache.has(key);
    setData(hasCachedValue ? (cache.get(key) ?? null) : null);
    setIsLoading(!hasCachedValue);
    setError(null);
    void refresh();
  }, [key, refresh]);

  return { data, isLoading, error, refresh };
}
