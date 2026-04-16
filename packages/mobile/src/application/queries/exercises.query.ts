import type { Exercise, ExerciseFilters } from "@/domain/models/exercise";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type ApiError, type Result } from "@/shared/errors";

/**
 * Exercise cache is considered stale after 24h.
 * Callers (UI containers) use this to decide whether to show a
 * "refreshing" indicator and trigger a background `refreshExerciseCache`.
 */
export const EXERCISE_CACHE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type GetExercisesQueryResult = {
  exercises: Exercise[];
  /** ISO timestamp of the oldest cached row, or null if cache is empty. */
  cacheAge: string | null;
  /** True when cache is empty or older than EXERCISE_CACHE_STALE_AFTER_MS. */
  isStale: boolean;
};

/**
 * Cache-first read of the exercise library.
 *
 * Reads from the local SQLite cache, applying filters locally via the
 * domain `filterExercises` service. Returns immediately — the caller is
 * responsible for invoking `refreshExerciseCache` when the returned
 * `isStale` is true (e.g. on app foreground or pull-to-refresh).
 *
 * Designed to be synchronous for instant UI response: a few thousand
 * cached exercises filter in sub-10ms, well under a frame.
 *
 * @param now — injectable clock; defaults to Date.now. Used to determine
 *   staleness deterministically in tests.
 */
export function getExercisesQuery(
  storage: StoragePort,
  filters?: ExerciseFilters,
  now: () => number = Date.now,
): GetExercisesQueryResult {
  const exercises = storage.getCachedExercises(filters);
  const cacheAge = storage.getExerciseCacheAge();
  const isStale =
    cacheAge === null ||
    now() - Date.parse(cacheAge) > EXERCISE_CACHE_STALE_AFTER_MS;
  return { exercises, cacheAge, isStale };
}

/**
 * Fetch a single exercise. Reads from cache first; if missing, falls
 * through to the API and writes the result into the cache on success.
 *
 * Returns a not_found error only when both cache and API lack the id.
 */
export async function getExerciseQuery(
  api: ApiPort,
  storage: StoragePort,
  id: string,
): Promise<Result<Exercise, ApiError>> {
  const cached = storage.getCachedExercise(id);
  if (cached) return ok(cached);

  const result = await api.getExercise(id);
  if (!result.ok) return result;

  storage.cacheExercises([result.value]);
  return ok(result.value);
}

/**
 * Refresh the full cached exercise library from the API and update
 * `last_synced_at` metadata. Triggers only on explicit events: pull-to-refresh,
 * app foreground, or post-mutation (debounced). No background polling.
 *
 * Returns the fresh list on success; returns the API error unchanged on
 * failure. On failure the existing cache is untouched, so callers can still
 * read stale-but-usable data via `getExercisesQuery`.
 */
export async function refreshExerciseCache(
  api: ApiPort,
  storage: StoragePort,
  filters?: ExerciseFilters,
): Promise<Result<Exercise[], ApiError>> {
  const result = await api.getExercises(filters);
  if (!result.ok) return result;

  storage.cacheExercises(result.value.data);
  storage.setLastSyncedAt("exercises", new Date().toISOString());
  return ok(result.value.data);
}
