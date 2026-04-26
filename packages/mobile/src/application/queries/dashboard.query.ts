/**
 * Dashboard query — cache-first read with background refresh (M1).
 *
 * Mirrors `reference-lists.query.ts`: one synchronous read
 * (`getDashboardQuery`) for immediate Home-tab render, one async refresh
 * helper (`refreshDashboard`) for network-backed updates that writes
 * through to the SQLite cache.
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard mobile architecture
 *       (M1) > Application query · requirements.md STORY-005 AC 5.9, 5.10
 */

import type {
  CachedDashboard,
  DashboardPayload,
} from "@/domain/models/dashboard";
import {
  DASHBOARD_STALE_AFTER_MS,
  isDashboardStale,
} from "@/domain/models/dashboard";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";

// Re-export the TTL so callers (e.g. UI captions) can render it without
// a deep domain import.
export { DASHBOARD_STALE_AFTER_MS };

/** Result shape returned by the synchronous cache read. */
export type DashboardQueryResult = {
  /** The cached payload, or null if no cache row exists yet. */
  payload: DashboardPayload | null;
  /**
   * True when the cache is empty OR the row is older than
   * `DASHBOARD_STALE_AFTER_MS`. UI uses this to decide whether to
   * trigger a background `refreshDashboard` alongside rendering the
   * cached payload.
   */
  isStale: boolean;
  /** The full cached row (including syncedAt), or null if empty. */
  cached: CachedDashboard | null;
};

/**
 * Synchronous read. Returns whatever is in the cache (possibly null)
 * plus an `isStale` flag derived from `syncedAt`.
 *
 * Does NOT touch the network. Call `refreshDashboard` when `isStale` is
 * true, from within a useEffect or a pull-to-refresh handler.
 */
export function getDashboardQuery(
  storage: StoragePort,
  userId: string,
  now: () => number = Date.now,
): DashboardQueryResult {
  const cached = storage.getCachedDashboard(userId);
  return {
    payload: cached?.payload ?? null,
    isStale: isDashboardStale(cached, now()),
    cached,
  };
}

/**
 * Fetch the latest dashboard payload from the backend and write it
 * through to storage.
 *
 * On success: caches the payload (stamps `syncedAt = now()`) and
 * returns the payload.
 * On failure: cache is left untouched — existing (possibly stale)
 * values remain readable via `getDashboardQuery`.
 *
 * Pull-to-refresh always calls this path, bypassing the TTL check in
 * `getDashboardQuery` (AC 5.10).
 */
export async function refreshDashboard(
  api: ApiPort,
  storage: StoragePort,
  userId: string,
): Promise<Result<DashboardPayload, ApiError>> {
  const result = await api.getDashboard();
  if (!result.ok) return result;
  storage.cacheDashboard(userId, result.value);
  return ok(result.value);
}
