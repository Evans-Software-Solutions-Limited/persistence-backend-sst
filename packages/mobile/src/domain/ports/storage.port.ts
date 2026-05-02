import type {
  CachedDashboard,
  DashboardPayload,
} from "@/domain/models/dashboard";
import type { Exercise, ExerciseFilters } from "@/domain/models/exercise";
import type {
  ReferenceEntry,
  ReferenceList,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import type {
  CachedWorkoutDetail,
  CachedWorkoutsList,
  Workout,
  WorkoutListType,
  WorkoutQuota,
} from "@/domain/models/workout";
import type { SyncOperation, SyncStatus } from "@/domain/ports/sync.types";

/**
 * Port for local persistence (SQLite).
 * Implementations: SQLiteStorageAdapter (prod), InMemoryStorageAdapter (test).
 *
 * Methods are added per-feature milestone.
 */
export interface StoragePort {
  /** Initialize local database tables */
  initialize(): Promise<void>;

  // -- Sync Queue --
  enqueueMutation(entry: EnqueueMutationInput): void;
  getPendingMutations(): SyncQueueEntry[];
  markMutationInFlight(id: number): void;
  markMutationCompleted(id: number): void;
  markMutationFailed(id: number, errorMessage: string): void;
  getSyncStats(): SyncStats;
  pruneCompletedMutations(olderThanHours?: number): void;

  // -- Sync Metadata --
  getLastSyncedAt(entityType: string): string | null;
  setLastSyncedAt(entityType: string, timestamp: string): void;

  // -- Exercise Cache --
  /** Read cached exercises, applying filters locally for instant response. */
  getCachedExercises(filters?: ExerciseFilters): Exercise[];
  /** Upsert a batch of exercises into the local cache (single transaction). */
  cacheExercises(exercises: Exercise[]): void;
  /** Read a single cached exercise by id, or null if not found. */
  getCachedExercise(id: string): Exercise | null;
  /** Age of the exercise cache as an ISO timestamp, or null if empty. */
  getExerciseCacheAge(): string | null;
  /**
   * Save a custom (user-created) exercise to the cache. Identical shape to
   * `cacheExercises` for a single row, but semantically separate so call-sites
   * document intent. Must set isCustom=true on the stored payload.
   */
  saveCustomExercise(exercise: Exercise): void;

  /**
   * Remove a single cached exercise by id. No-op when the row isn't
   * cached. Used by the delete-exercise command after a successful
   * API DELETE so the list updates immediately.
   */
  removeCachedExercise(id: string): void;

  // -- Reference-List Cache --
  /**
   * Read the cached reference list for a kind, or null if not cached yet.
   *
   * Spec: design.md § Reference-List Cache > Port extensions · AC 7.10, 7.14
   */
  getCachedReferenceList(kind: ReferenceListKind): ReferenceList | null;
  /**
   * Replace the cached entries for a kind in a single operation. Sets
   * `synced_at` to now in implementation.
   */
  cacheReferenceList(kind: ReferenceListKind, entries: ReferenceEntry[]): void;
  /**
   * Age of the cached reference list as an ISO timestamp, or null if empty.
   * Equivalent to `getCachedReferenceList(kind)?.syncedAt ?? null` but
   * cheaper when the caller only needs the timestamp.
   */
  getReferenceListAge(kind: ReferenceListKind): string | null;

  // -- Workouts Cache (M2) --
  /**
   * Read the cached workouts list slice for `(userId, type)`. Returns
   * null when the slice has never been cached. The query layer uses this
   * + `isWorkoutsListStale` to decide whether to render cache-first then
   * background-refresh.
   *
   * Spec: specs/04-workout-management/design.md § SQLite cache shape
   */
  getCachedWorkoutsList(
    userId: string,
    type: WorkoutListType,
  ): CachedWorkoutsList | null;

  /**
   * Write-through the latest backend list slice for `(userId, type)`.
   * Stamps `syncedAt = now()`. `quota` should be non-null only when
   * `type='mine'` (matching the backend's envelope semantics).
   */
  cacheWorkoutsList(
    userId: string,
    type: WorkoutListType,
    workouts: Workout[],
    quota: WorkoutQuota | null,
  ): void;

  /** ISO timestamp of the last cached refresh, or null if no row. */
  getWorkoutsListAge(userId: string, type: WorkoutListType): string | null;

  /**
   * Read the cached single-workout detail. Populated by the popover
   * detail open and refreshed by every list refetch (the list response
   * carries full workout payloads, so we splatter them into the detail
   * cache too).
   */
  getCachedWorkoutDetail(
    userId: string,
    workoutId: string,
  ): CachedWorkoutDetail | null;

  /** Write-through the workout detail. Stamps `syncedAt = now()`. */
  cacheWorkoutDetail(userId: string, workout: Workout): void;

  /**
   * Remove a workout from list + detail caches after a successful
   * delete. No-op when the rows aren't cached.
   */
  removeCachedWorkout(userId: string, workoutId: string): void;

  // -- Dashboard Cache (M1) --
  /**
   * Read the cached dashboard payload for a user, or null if none.
   *
   * Spec: specs/06-progress-goals/design.md § Dashboard mobile architecture
   *       (M1) > Offline cache · requirements.md STORY-005 AC 5.9
   */
  getCachedDashboard(userId: string): CachedDashboard | null;
  /**
   * Write-through the latest backend payload for a user, stamping
   * `syncedAt = now()`.
   */
  cacheDashboard(userId: string, payload: DashboardPayload): void;
  /**
   * Age of the cached dashboard as an ISO timestamp, or null if none.
   * Equivalent to `getCachedDashboard(userId)?.syncedAt ?? null` but
   * cheaper when only the timestamp is needed (stale-indicator caption).
   */
  getDashboardAge(userId: string): string | null;
  /**
   * Drop the cached dashboard payload for a user. Called by mutation
   * commands that change data the dashboard depends on (e.g. workout
   * create / edit / delete affects `recentWorkouts`) so the next
   * dashboard read sees the cache as missing/stale and triggers a
   * fresh fetch instead of showing the pre-mutation snapshot.
   */
  invalidateDashboard(userId: string): void;

  // -- Lifecycle --
  /** Clear all user data (sync queue, cached entities, metadata). Called on sign-out. */
  clearAll(): void;
}

export type EnqueueMutationInput = {
  entityType: string;
  entityId?: string;
  operation: SyncOperation;
  payload: unknown;
  endpoint: string;
  method: string;
};

export type SyncQueueEntry = {
  id: number;
  entityType: string;
  entityId: string | null;
  operation: SyncOperation;
  payload: string;
  endpoint: string;
  method: string;
  status: SyncStatus;
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  createdAt: string;
};

export type SyncStats = {
  pending: number;
  failed: number;
  inFlight: number;
};
