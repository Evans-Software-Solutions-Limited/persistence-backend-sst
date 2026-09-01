import { useCallback, useEffect, useRef, useState } from "react";
import type { ExercisePerformanceSummary } from "@/domain/models/exercisePerformance";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/** Stable cache-key contract shared with future persistent/query clients. */
export const exercisePerformanceSummaryKey = (
  userId: string,
  exerciseId: string,
) => ["exercise-performance-summary", userId, exerciseId] as const;

// The summary changes with workout history and is private to both user and
// exercise. Keep that full identity in the process cache and request guard.
const cache = new Map<string, ExercisePerformanceSummary | null>();
// Shared across hook instances so a request started by an older/unmounted
// detail screen cannot overwrite a newer screen's result for the same key.
const requestGenerationByKey = new Map<string, number>();
const cacheId = (userId: string, exerciseId: string) =>
  `${userId}:${exerciseId}`;

export function useExercisePerformanceSummary(
  exerciseId: string | null,
  enabled = true,
): {
  data: ExercisePerformanceSummary | null;
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
  const requestRevisionRef = useRef(0);
  const [data, setData] = useState<ExercisePerformanceSummary | null>(() =>
    key && cache.has(key) ? (cache.get(key) ?? null) : null,
  );
  const [dataKey, setDataKey] = useState<string | null>(key);
  const [isLoading, setIsLoading] = useState(key != null && !cache.has(key));
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    if (!key || !exerciseId) return;
    const requestKey = key;
    const requestRevision = ++requestRevisionRef.current;
    const requestGeneration = (requestGenerationByKey.get(requestKey) ?? 0) + 1;
    requestGenerationByKey.set(requestKey, requestGeneration);
    setIsLoading(true);
    const result = await api.getExercisePerformanceSummary(exerciseId);
    if (result.ok) {
      if (
        activeKeyRef.current !== requestKey ||
        requestRevisionRef.current !== requestRevision ||
        requestGenerationByKey.get(requestKey) !== requestGeneration
      )
        return;
      cache.set(requestKey, result.value);
      setData(result.value);
      setDataKey(requestKey);
      setError(null);
    } else {
      if (
        activeKeyRef.current !== requestKey ||
        requestRevisionRef.current !== requestRevision ||
        requestGenerationByKey.get(requestKey) !== requestGeneration
      )
        return;
      setError(result.error);
    }
    if (
      activeKeyRef.current === requestKey &&
      requestRevisionRef.current === requestRevision &&
      requestGenerationByKey.get(requestKey) === requestGeneration
    )
      setIsLoading(false);
  }, [api, exerciseId, key]);

  useEffect(() => {
    if (!key) {
      requestRevisionRef.current += 1;
      setData(null);
      setDataKey(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    const hasCachedValue = cache.has(key);
    setData(hasCachedValue ? (cache.get(key) ?? null) : null);
    setDataKey(key);
    setIsLoading(!hasCachedValue);
    setError(null);
    void refresh();
  }, [key, refresh]);

  const visibleData = key
    ? dataKey === key
      ? data
      : (cache.get(key) ?? null)
    : null;

  return {
    // Never expose a previous user's/exercise's private summary during the
    // render before the key-reset effect runs.
    data: visibleData,
    isLoading:
      key == null ? false : dataKey === key ? isLoading : !cache.has(key),
    error: key != null && dataKey === key ? error : null,
    refresh,
  };
}
