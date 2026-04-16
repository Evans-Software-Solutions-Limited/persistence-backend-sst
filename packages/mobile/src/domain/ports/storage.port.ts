import type { Exercise, ExerciseFilters } from "@/domain/models/exercise";
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
