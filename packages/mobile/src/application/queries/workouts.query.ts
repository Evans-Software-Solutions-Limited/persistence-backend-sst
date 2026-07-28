/**
 * Workouts list query — cache-first read with three-section parallel
 * refresh (M2).
 *
 * Mirrors `dashboard.query.ts` (single-payload) but fans out to three
 * sections (mine / assigned / default) per the legacy Workouts tab. The
 * synchronous read + async refresh helpers are split so the UI can render
 * cache-first then fire a background refresh.
 *
 * Spec: specs/04-workout-management/design.md § Offline Strategy
 *       specs/04-workout-management/requirements.md STORY-001 ACs 1.6, 1.8
 */

import {
  WORKOUTS_LIST_STALE_AFTER_MS,
  isWorkoutsListStale,
  type CachedWorkoutsList,
  type WorkoutListType,
  type WorkoutQuota,
  type Workout,
} from "@/domain/models/workout";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";

export { WORKOUTS_LIST_STALE_AFTER_MS };

export type WorkoutsSectionState = {
  workouts: Workout[];
  quota: WorkoutQuota | null;
  isStale: boolean;
  cached: CachedWorkoutsList | null;
};

export type WorkoutsQueryResult = {
  mine: WorkoutsSectionState;
  assigned: WorkoutsSectionState;
  default: WorkoutsSectionState;
};

const SECTIONS: readonly WorkoutListType[] = ["mine", "assigned", "default"];

/**
 * Synchronous cache read across the three section types. Returns whatever
 * is in the cache (possibly null per section) plus an `isStale` flag per
 * section derived from `syncedAt`.
 *
 * Does NOT touch the network. Call `refreshWorkouts` for a single section
 * (or `refreshAllWorkouts` for all three in parallel) when any `isStale`
 * is true.
 */
export function getWorkoutsQuery(
  storage: StoragePort,
  userId: string,
  now: () => number = Date.now,
): WorkoutsQueryResult {
  const out = {} as WorkoutsQueryResult;
  for (const type of SECTIONS) {
    const cached = storage.getCachedWorkoutsList(userId, type);
    out[type] = {
      workouts: cached?.workouts ?? [],
      quota: cached?.quota ?? null,
      isStale: isWorkoutsListStale(cached, now()),
      cached,
    };
  }
  return out;
}

/**
 * Cached rows in this slice that the server has not accepted yet, and which a
 * write-through would therefore destroy.
 *
 * "Not accepted yet" is decided by the QUEUE, not by the id's shape: a row whose
 * create has COMPLETED is server-truth (its id may simply not have been swapped
 * yet) and must NOT be preserved, or a workout the user deleted server-side would
 * keep reappearing. A row with an outstanding create is the opposite case.
 */
export function unsyncedWorkoutsIn(
  storage: StoragePort,
  cached: readonly Workout[] | null | undefined,
): Workout[] {
  if (!cached || cached.length === 0) return [];
  return cached.filter((w) => {
    if (!w.id.startsWith("local-")) return false;
    return storage
      .getQueuedEntriesForEntity("workout", w.id)
      .some((entry) => entry.operation === "create");
  });
}

function unsyncedWorkoutsInSlice(
  storage: StoragePort,
  userId: string,
  type: WorkoutListType,
): Workout[] {
  return unsyncedWorkoutsIn(
    storage,
    storage.getCachedWorkoutsList(userId, type)?.workouts,
  );
}

/**
 * Fetch a single section slice from the backend and write it through to
 * cache. On success the cached row's `syncedAt` is bumped to now.
 *
 * Pull-to-refresh always calls this path, bypassing the TTL check in
 * `getWorkoutsQuery`.
 */
export async function refreshWorkouts(
  api: ApiPort,
  storage: StoragePort,
  userId: string,
  type: WorkoutListType,
  ownerLibraryOnly = false,
): Promise<
  Result<{ workouts: Workout[]; quota: WorkoutQuota | null }, ApiError>
> {
  // ownerLibraryOnly only affects the `mine` section (trainer de-crowding).
  const result = await api.getWorkouts({
    type,
    ownerLibraryOnly: type === "mine" ? ownerLibraryOnly : undefined,
  });
  if (!result.ok) return result;
  // ⚠ Preserve rows the server cannot know about yet.
  //
  // `cacheWorkoutsList` REPLACES the whole slice, so writing the server's list
  // straight through deleted any optimistic `local-…` workout whose create had
  // not landed — silently, and permanently, since every later refresh did it
  // again. That is why a saved workout could vanish and the list read
  // "MY WORKOUTS · 0 SAVED": the row had been destroyed, not merely hidden.
  // `useWorkouts.refresh` drains before fetching to avoid exactly this, but the
  // drain cannot help when the create is failing (or is terminal, and so not even
  // returned by `getPendingMutations`).
  //
  // Merged at the front — a just-created workout belongs at the top of the list,
  // which is also where the optimistic write put it.
  const unsynced = unsyncedWorkoutsInSlice(storage, userId, type);
  storage.cacheWorkoutsList(
    userId,
    type,
    [...unsynced, ...result.value.workouts],
    result.value.quota,
  );
  // Splatter detail rows from the list payload — every list response
  // carries full Workout payloads, so the popover detail can hit the
  // cache without an extra GET /workouts/:id round-trip.
  for (const w of result.value.workouts) {
    storage.cacheWorkoutDetail(userId, w);
  }
  return ok({ workouts: result.value.workouts, quota: result.value.quota });
}

/**
 * Convenience: refresh all three sections in parallel. Each section's
 * Result is reported individually so a failure on one section doesn't
 * block the others (e.g. assigned can fail-soft when the user has no
 * trainer relationship while mine + default still succeed).
 */
export async function refreshAllWorkouts(
  api: ApiPort,
  storage: StoragePort,
  userId: string,
  // Trainer-only: filters the `mine` section to owner-visible workouts so a
  // coach's personal My Workouts isn't crowded by client-authored ones.
  ownerLibraryOnly = false,
): Promise<{
  mine: Result<{ workouts: Workout[]; quota: WorkoutQuota | null }, ApiError>;
  assigned: Result<
    { workouts: Workout[]; quota: WorkoutQuota | null },
    ApiError
  >;
  default: Result<
    { workouts: Workout[]; quota: WorkoutQuota | null },
    ApiError
  >;
}> {
  const [mine, assigned, defaultSection] = await Promise.all([
    refreshWorkouts(api, storage, userId, "mine", ownerLibraryOnly),
    refreshWorkouts(api, storage, userId, "assigned"),
    refreshWorkouts(api, storage, userId, "default"),
  ]);
  return { mine, assigned, default: defaultSection };
}
