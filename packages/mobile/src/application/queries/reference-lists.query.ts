/**
 * Reference-list query — cache-first read with background refresh.
 *
 * Mirrors the `exercises.query.ts` shape: one synchronous read
 * (`getReferenceListQuery`) for immediate UI render, one async
 * refresh helper (`refreshReferenceList`) for network-backed updates.
 *
 * The cache lives in StoragePort; the API roundtrip goes through
 * ApiPort. Neither port knows about staleness — the query layer does
 * the glue.
 *
 * Spec: specs/03-exercise-library/design.md § Reference-List Cache >
 *       Application query · requirements.md AC 7.10, AC 7.14
 */

import type {
  ReferenceEntry,
  ReferenceList,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import { isReferenceListStale } from "@/domain/models/reference-list";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";

/** Result shape returned by the synchronous cache read. */
export type ReferenceListQueryResult = {
  /** Cached entries, or an empty array if the cache is empty. */
  entries: ReferenceEntry[];
  /**
   * True when the cache is empty OR older than the staleness window.
   * UI uses this to decide whether to trigger a background refresh
   * alongside rendering the cached list.
   */
  isStale: boolean;
  /** The full cached list (including syncedAt), or null if empty. */
  cached: ReferenceList | null;
};

/**
 * Synchronous read. Returns whatever is in the cache (may be empty)
 * plus an `isStale` flag derived from `syncedAt`.
 *
 * Does NOT touch the network. Call `refreshReferenceList` separately
 * when `isStale` is true.
 */
export function getReferenceListQuery(
  storage: StoragePort,
  kind: ReferenceListKind,
  now: () => number = Date.now,
): ReferenceListQueryResult {
  const cached = storage.getCachedReferenceList(kind);
  return {
    entries: cached?.entries ?? [],
    isStale: isReferenceListStale(cached, now()),
    cached,
  };
}

/**
 * Fetch fresh entries from the backend and persist them.
 *
 * On success: writes the new entries to the cache (updates syncedAt)
 * and returns them.
 * On failure: cache is left untouched — existing (possibly stale)
 * values remain readable via `getReferenceListQuery`.
 */
export async function refreshReferenceList(
  api: ApiPort,
  storage: StoragePort,
  kind: ReferenceListKind,
): Promise<Result<ReferenceEntry[], ApiError>> {
  const result = await api.getReferenceList(kind);
  if (!result.ok) return result;
  storage.cacheReferenceList(kind, result.value);
  return ok(result.value);
}
