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
import type { StoragePort, SyncQueueEntry } from "@/domain/ports/storage.port";
import { isAutoResolvableSyncEntry } from "@/domain/ports/sync.types";
import { ok, type Result, type ApiError } from "@/shared/errors";

export { PROFILE_PAGE_STALE_AFTER_MS };

export type ProfilePageQueryResult = {
  payload: ProfilePageData | null;
  isStale: boolean;
  cached: CachedProfilePage | null;
};

/** Merge eligible offline profile intent over a possibly older GET response.
 * Apply in queue order so newer patches win independently for each field.
 */
export function reconcilePendingProfilePreferences(
  storage: StoragePort,
  userId: string,
  payload: ProfilePageData,
  cachedAtRequestStart?: string,
  queuedAtRequestStart: SyncQueueEntry[] = [],
): ProfilePageData {
  // A quick edit can already be acknowledged/pruned while an older GET is
  // outstanding. Compare content, not millisecond timestamps, so that GET
  // cannot roll back accepted intent once it has left the pending queue.
  const cached = storage.getCachedProfilePage(userId)?.payload;
  const cacheChanged =
    cachedAtRequestStart !== undefined &&
    cached &&
    JSON.stringify(cached) !== cachedAtRequestStart;
  if (cacheChanged) payload = cached;
  // A mutation already queued before the GET may be acknowledged during it,
  // without changing the optimistic cache. Preserve that request-start intent
  // too. Newer cache content wins; terminally rejected rows never shadow GETs.
  const acknowledged = cacheChanged
    ? []
    : queuedAtRequestStart.filter((entry) => {
        const current = storage.getMutationById(entry.id);
        return (
          isAutoResolvableSyncEntry(entry) &&
          (!current || current.status === "completed")
        );
      });
  const profile = { ...payload.profile };
  for (const entry of [
    ...acknowledged,
    ...storage.getQueuedEntriesForEntity("profile", userId),
  ]) {
    if (
      entry.endpoint !== "/profile" ||
      entry.method !== "PATCH" ||
      !isAutoResolvableSyncEntry(entry)
    )
      continue;
    try {
      const update: unknown = JSON.parse(entry.payload);
      if (!update || typeof update !== "object" || Array.isArray(update))
        continue;
      const patch = update as Record<string, unknown>;
      if (typeof patch.showTemplateWorkouts === "boolean")
        profile.showTemplateWorkouts = patch.showTemplateWorkouts;
      if (typeof patch.fullName === "string" || patch.fullName === null)
        profile.fullName = patch.fullName;
      if (typeof patch.dateOfBirth === "string" || patch.dateOfBirth === null)
        profile.dateOfBirth = patch.dateOfBirth;
      if (
        patch.gender === "male" ||
        patch.gender === "female" ||
        patch.gender === "other" ||
        patch.gender === null
      )
        profile.gender = patch.gender;
      if (
        (typeof patch.heightCm === "number" &&
          Number.isFinite(patch.heightCm)) ||
        patch.heightCm === null
      )
        profile.heightCm = patch.heightCm;
      if (patch.weightUnit === "kg" || patch.weightUnit === "lb")
        profile.weightUnit = patch.weightUnit;
      if (patch.heightUnit === "cm" || patch.heightUnit === "ftin")
        profile.heightUnit = patch.heightUnit;
      if (typeof patch.isProfilePublic === "boolean")
        profile.isProfilePublic = patch.isProfilePublic;
      if (
        patch.fitnessLevel === "beginner" ||
        patch.fitnessLevel === "intermediate" ||
        patch.fitnessLevel === "advanced" ||
        patch.fitnessLevel === "elite" ||
        patch.fitnessLevel === null
      )
        profile.fitnessLevel = patch.fitnessLevel;
    } catch {
      // Sync owns surfacing malformed/terminal entries; they are not authority.
    }
  }
  return { ...payload, profile };
}

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
    payload: cached
      ? reconcilePendingProfilePreferences(storage, userId, cached.payload)
      : null,
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
  const cachedAtRequestStart = JSON.stringify(
    storage.getCachedProfilePage(userId)?.payload ?? null,
  );
  const queuedAtRequestStart = storage.getQueuedEntriesForEntity(
    "profile",
    userId,
  );
  const result = await api.getProfilePage();
  if (!result.ok) return result;
  const payload = reconcilePendingProfilePreferences(
    storage,
    userId,
    result.value,
    cachedAtRequestStart,
    queuedAtRequestStart,
  );
  storage.cacheProfilePage(userId, payload);
  return ok(payload);
}
