import type { Exercise, ExerciseFilters } from "@/domain/models/exercise";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type ApiError, type Result } from "@/shared/errors";

/**
 * Exercise cache is considered stale after 24h.
 * Callers (UI containers) use this to decide whether to show a
 * "refreshing" indicator and trigger a background `refreshExerciseCache`.
 */
export const EXERCISE_CACHE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type GetExercisesQueryResult = {
  exercises: Exercise[];
  /**
   * ISO timestamp of the last completed full refresh of the exercise
   * library, or null if no full refresh has ever succeeded. Matches
   * `sync_metadata.last_synced_at` for entity "exercises".
   *
   * This is specifically the sync-complete marker, not the per-row cache
   * age. A progressively-cached library from a truncated or failed
   * refresh will have fresh per-row timestamps but a null `lastSyncedAt`,
   * and must be treated as stale until a full refresh completes.
   */
  lastSyncedAt: string | null;
  /**
   * True when no full refresh has ever completed, OR the last completed
   * refresh is older than `EXERCISE_CACHE_STALE_AFTER_MS`.
   */
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
 * Staleness is determined from `sync_metadata.last_synced_at` (written
 * only after a full paginated walk completes), NOT from the oldest
 * cached row. A progressive cache from a failed or truncated refresh
 * therefore remains stale — the UI will keep attempting to refresh
 * rather than silently sitting on a partial library for 24h.
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
  const lastSyncedAt = storage.getLastSyncedAt("exercises");
  const isStale =
    lastSyncedAt === null ||
    now() - Date.parse(lastSyncedAt) > EXERCISE_CACHE_STALE_AFTER_MS;
  return { exercises, lastSyncedAt, isStale };
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
 * Upper bound on pages fetched in a single refresh to stop runaway loops
 * if the backend ever mis-reports `hasMore`. At ~200 exercises per page
 * this covers libraries up to ~20k rows, well above expected scale.
 * If the cap is hit while the server still reports more pages, the walk
 * is treated as incomplete — see `refreshExerciseCache`.
 */
export const REFRESH_MAX_PAGES = 100;

/**
 * Refresh the full cached exercise library from the API and update
 * `last_synced_at` metadata. Triggers only on explicit events: pull-to-refresh,
 * app foreground, or post-mutation (debounced). No background polling.
 *
 * Walks paginated responses until `hasMore` is false (or no cursor is
 * returned). Caches each page as it arrives so a long refresh makes
 * progressive data available, and records `last_synced_at` only when the
 * walk reaches the server's reported end.
 *
 * If the walk hits `REFRESH_MAX_PAGES` while the server still reports
 * `hasMore: true`, the refresh is considered truncated: rows fetched so
 * far stay in the cache (progressive caching), but `last_synced_at` is
 * NOT written — otherwise the 24h freshness window would suppress the
 * next refresh and leave the user on a partial library. A truncated
 * result returns an api/server error so the caller can surface the
 * problem (and logging/telemetry can flag it).
 *
 * Returns the merged list on success; returns the API error unchanged on
 * upstream failure. On any failure the existing cache rows are untouched,
 * so callers can still read stale-but-usable data via `getExercisesQuery`.
 */
export async function refreshExerciseCache(
  api: ApiPort,
  storage: StoragePort,
  filters?: ExerciseFilters,
): Promise<Result<Exercise[], ApiError>> {
  const all: Exercise[] = [];
  let offset = 0;
  let reachedEnd = false;

  for (let page = 0; page < REFRESH_MAX_PAGES; page++) {
    const result = await api.getExercises(filters, offset);
    if (!result.ok) return result;

    const { data, hasMore } = result.value;
    if (data.length > 0) storage.cacheExercises(data);
    all.push(...data);

    if (!hasMore || data.length === 0) {
      reachedEnd = true;
      break;
    }
    offset += data.length;
  }

  if (!reachedEnd) {
    return fail({
      kind: "api",
      code: "server",
      message: `Exercise refresh truncated at ${REFRESH_MAX_PAGES} pages; server still reports more data. last_synced_at not updated.`,
    });
  }

  storage.setLastSyncedAt("exercises", new Date().toISOString());
  return ok(all);
}
