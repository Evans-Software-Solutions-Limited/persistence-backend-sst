/**
 * Profile-page query — cache-first read with background refresh (M6).
 *
 * Mirrors `dashboard.query.ts` 1:1, swapped to the profile-page payload.
 *
 * Spec: specs/milestones/M6-profile/BACKEND_BRIEF.md § Local-DB caching
 */

import type {
  CachedProfilePage,
  ProfilePageData,
} from "@/domain/models/profilePage";
import {
  PROFILE_PAGE_STALE_AFTER_MS,
  isProfilePageStale,
} from "@/domain/models/profilePage";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";

export { PROFILE_PAGE_STALE_AFTER_MS };

export type ProfilePageQueryResult = {
  payload: ProfilePageData | null;
  isStale: boolean;
  cached: CachedProfilePage | null;
};

/**
 * Synchronous read. Returns whatever is in the cache (possibly null)
 * plus an `isStale` flag derived from `syncedAt`.
 *
 * Does NOT touch the network. Call `refreshProfilePage` when
 * `isStale` is true, from within a useEffect or pull-to-refresh.
 */
export function getProfilePageQuery(
  storage: StoragePort,
  userId: string,
  now: () => number = Date.now,
): ProfilePageQueryResult {
  const cached = storage.getCachedProfilePage(userId);
  return {
    payload: cached?.payload ?? null,
    isStale: isProfilePageStale(cached, now()),
    cached,
  };
}

/**
 * Fetch the latest profile-page payload from the backend and write it
 * through to storage.
 *
 * On success: caches the payload (stamps `syncedAt = now()`) and
 * returns the payload.
 * On failure: cache is left untouched — existing (possibly stale)
 * values remain readable via `getProfilePageQuery`.
 *
 * Pull-to-refresh always calls this path, bypassing the TTL check in
 * `getProfilePageQuery`.
 */
export async function refreshProfilePage(
  api: ApiPort,
  storage: StoragePort,
  userId: string,
): Promise<Result<ProfilePageData, ApiError>> {
  const result = await api.getProfilePage();
  if (!result.ok) return result;
  storage.cacheProfilePage(userId, result.value);
  return ok(result.value);
}
