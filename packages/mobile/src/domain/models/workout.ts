/**
 * Workout domain model — M2 Workouts surface.
 *
 * Mirrors `Workout` and `WorkoutExercise` from `specs/04-workout-management/
 * design.md` § Domain Model. Wire shape matches camelCase exactly — no
 * snake_case → camel mapping needed because the backend emits via Drizzle
 * which already produces camelCase.
 *
 * Spec: specs/04-workout-management/design.md § Domain Model + § API Contract
 *       specs/04-workout-management/requirements.md STORY-001..009
 */

export type WorkoutVisibility = "private" | "friends" | "public";

export type WorkoutListType = "mine" | "assigned" | "default";

export type WorkoutExerciseRef = {
  id: string;
  name: string;
  category: string;
  difficultyLevel: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
};

export type WorkoutExercise = {
  id: string;
  exerciseId: string;
  sortOrder: number;
  /** Same non-null int = same superset; null = standalone exercise. */
  supersetGroup: number | null;
  targetSets: number | null;
  targetRepsMin: number;
  targetRepsMax: number;
  targetDurationSeconds: number | null;
  restSeconds: number | null;
  notes: string | null;
  /**
   * Joined exercise metadata. Null when the underlying exercise has been
   * deleted (FK cascade leaves the row but with no joinable target).
   */
  exercise: WorkoutExerciseRef | null;
};

export type Workout = {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  visibility: WorkoutVisibility;
  estimatedDurationMinutes: number;
  /**
   * Owner-visibility: does this workout appear in its author's own personal
   * "My Workouts"? Backend column `show_in_owner_library` (NOT NULL, default
   * true). Coaches author client workouts with this false so they don't crowd
   * the coach's personal library; a coach-only toggle in the creator overrides.
   */
  showInOwnerLibrary: boolean;
  exercises: WorkoutExercise[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Per-workout completed-session history for the CALLING user, feeding the
 * detail hero's market-standard stats block. From `GET /workouts/:id/history`.
 * All aggregates are the caller's own completed sessions of this workout.
 */
export type WorkoutHistory = {
  /** Times the user has completed this workout. 0 = never done. */
  completedCount: number;
  /** ISO timestamp of the most recent completed session, or null. */
  lastCompletedAt: string | null;
  /** Mean session length across completed sessions, in seconds, or null. */
  avgDurationSeconds: number | null;
  /** Most recent completed session's headline stats, or null when never done. */
  lastSession: {
    completedAt: string;
    totalVolumeKg: number;
    durationSeconds: number | null;
  } | null;
};

/**
 * Quota envelope returned alongside `type=mine` workouts list. `limit` is
 * the active subscription tier's `workout_limit`, or `null` when the user
 * has no active subscription / unlimited tier. M10 will gate on this; M2
 * just plumbs it through to `WorkoutLimitIndicator`.
 */
export type WorkoutQuota = {
  used: number;
  limit: number | null;
};

/**
 * Form input for create / update. `exercises` is required for create
 * (M2 frontend always sends ≥1) but the backend allows `[]` for testing.
 * For PATCH, when present the backend treats `exercises` as a full
 * replacement of the workout's exercise list.
 */
export type WorkoutExerciseInput = {
  exerciseId: string;
  sortOrder: number;
  supersetGroup?: number | null;
  targetSets?: number | null;
  targetRepsMin?: number;
  targetRepsMax?: number;
  targetDurationSeconds?: number | null;
  restSeconds?: number | null;
  notes?: string | null;
};

export type CreateWorkoutInput = {
  name: string;
  description?: string | null;
  visibility?: WorkoutVisibility;
  estimatedDurationMinutes?: number;
  /** Absent => backend defaults true (personal). Coach flow sends false. */
  showInOwnerLibrary?: boolean;
  exercises: WorkoutExerciseInput[];
};

export type UpdateWorkoutInput = {
  name?: string;
  description?: string | null;
  visibility?: WorkoutVisibility;
  estimatedDurationMinutes?: number;
  showInOwnerLibrary?: boolean;
  exercises?: WorkoutExerciseInput[];
};

/**
 * Locally-cached list slice. One row per `(userId, type)` in the
 * `cached_workouts` SQLite table. `quota` is only populated when the row
 * is for `type='mine'`; null otherwise.
 */
export type CachedWorkoutsList = {
  userId: string;
  type: WorkoutListType;
  workouts: Workout[];
  quota: WorkoutQuota | null;
  /** ISO timestamp when the payload was last refreshed from the backend. */
  syncedAt: string;
};

/**
 * Locally-cached detail slice. One row per `(userId, workoutId)` in the
 * `cached_workout_detail` SQLite table. Populated on first popover open
 * and refreshed by every list refetch (the list response includes full
 * workout payloads, so we splatter them into the detail cache too).
 */
export type CachedWorkoutDetail = {
  userId: string;
  workoutId: string;
  workout: Workout;
  syncedAt: string;
};

/**
 * Locally-cached per-workout history slice. One row per `(userId, workoutId)`
 * in the `cached_workout_history` SQLite table, feeding the detail hero's
 * history block offline (cache-first, mirroring `CachedWorkoutDetail`).
 */
export type CachedWorkoutHistory = {
  userId: string;
  workoutId: string;
  history: WorkoutHistory;
  /** ISO timestamp when the payload was last refreshed from the backend. */
  syncedAt: string;
};

/**
 * 5-minute TTL — same as dashboard. Workouts list shifts when a session
 * completes or a PT assigns a new template; tighter than the 24h
 * reference-list cache. Exported so both query layer and "last synced"
 * UI captions read the same constant.
 */
export const WORKOUTS_LIST_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Pure staleness check. Used by the query layer and stale-indicator
 * captions.
 */
export function isWorkoutsListStale(
  cached: CachedWorkoutsList | null,
  now: number = Date.now(),
  staleAfterMs: number = WORKOUTS_LIST_STALE_AFTER_MS,
): boolean {
  if (!cached) return true;
  const syncedAt = Date.parse(cached.syncedAt);
  if (Number.isNaN(syncedAt)) return true;
  return now - syncedAt >= staleAfterMs;
}

/**
 * Same TTL semantics for individual workout detail. Distinct function
 * to keep the per-cache-shape boundary clean even though the constant
 * is shared.
 */
export function isWorkoutDetailStale(
  cached: CachedWorkoutDetail | null,
  now: number = Date.now(),
  staleAfterMs: number = WORKOUTS_LIST_STALE_AFTER_MS,
): boolean {
  if (!cached) return true;
  const syncedAt = Date.parse(cached.syncedAt);
  if (Number.isNaN(syncedAt)) return true;
  return now - syncedAt >= staleAfterMs;
}

/** Same TTL semantics for the per-workout history cache slice. */
export function isWorkoutHistoryStale(
  cached: CachedWorkoutHistory | null,
  now: number = Date.now(),
  staleAfterMs: number = WORKOUTS_LIST_STALE_AFTER_MS,
): boolean {
  if (!cached) return true;
  const syncedAt = Date.parse(cached.syncedAt);
  if (Number.isNaN(syncedAt)) return true;
  return now - syncedAt >= staleAfterMs;
}
