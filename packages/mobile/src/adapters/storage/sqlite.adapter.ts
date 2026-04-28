import * as SQLite from "expo-sqlite";
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
import { filterExercises } from "@/domain/services/exercise.service";
import type {
  StoragePort,
  EnqueueMutationInput,
  SyncQueueEntry,
  SyncStats,
} from "@/domain/ports/storage.port";
import type { SyncOperation, SyncStatus } from "@/domain/ports/sync.types";

const DB_NAME = "persistence.db";

/**
 * SQLite storage adapter implementing StoragePort.
 *
 * Manages the local database for offline-first support:
 * - Sync queue (pending mutations)
 * - Cached server data
 * - Sync metadata
 */
export class SQLiteStorageAdapter implements StoragePort {
  private db: SQLite.SQLiteDatabase | null = null;

  private getDb(): SQLite.SQLiteDatabase {
    if (!this.db) {
      this.db = SQLite.openDatabaseSync(DB_NAME);
      this.db.execSync("PRAGMA journal_mode = WAL;");
      this.db.execSync("PRAGMA foreign_keys = ON;");
    }
    return this.db;
  }

  async initialize(): Promise<void> {
    const db = this.getDb();

    db.execSync(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        operation TEXT NOT NULL CHECK(operation IN ('create', 'update', 'delete')),
        payload TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_flight', 'failed', 'completed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Pre-M2 the table was a flat keyed-by-id stash with no usage in
      -- shipped code; M2 replaces it with a (user_id, type)-keyed cache
      -- of full list slices. DROP IF EXISTS is safe because no shipped
      -- writes touched the old table.
      DROP TABLE IF EXISTS cached_workouts;

      CREATE TABLE IF NOT EXISTS cached_workouts (
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('mine', 'assigned', 'default')),
        payload TEXT NOT NULL,
        quota TEXT,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, type)
      );

      CREATE TABLE IF NOT EXISTS cached_workout_detail (
        user_id TEXT NOT NULL,
        workout_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, workout_id)
      );

      CREATE TABLE IF NOT EXISTS cached_exercises (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        synced_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS active_session (
        id TEXT PRIMARY KEY,
        server_id TEXT,
        data TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'local' CHECK(status IN ('local', 'synced', 'pending_sync')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sync_metadata (
        entity_type TEXT PRIMARY KEY,
        last_synced_at TEXT NOT NULL,
        sync_version INTEGER NOT NULL DEFAULT 0
      );

      -- M0: reference-list cache. Each row holds one catalog
      -- (muscle_groups / equipment / categories). Entries is a
      -- JSON-serialised ReferenceEntry[].
      CREATE TABLE IF NOT EXISTS reference_lists (
        kind TEXT PRIMARY KEY,
        entries TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );

      -- M1: dashboard cache. One row per user; payload is the full
      -- JSON-serialised DashboardPayload. 5-minute TTL (see
      -- DASHBOARD_STALE_AFTER_MS) is enforced by the query layer,
      -- not the storage adapter.
      CREATE TABLE IF NOT EXISTS cached_dashboard (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_cached_exercises_synced_at ON cached_exercises(synced_at);
    `);
  }

  // -- Sync Queue --

  enqueueMutation(entry: EnqueueMutationInput): void {
    const db = this.getDb();
    db.runSync(
      `INSERT INTO sync_queue (entity_type, entity_id, operation, payload, endpoint, method)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.entityType,
        entry.entityId ?? null,
        entry.operation,
        JSON.stringify(entry.payload),
        entry.endpoint,
        entry.method,
      ],
    );
  }

  getPendingMutations(): SyncQueueEntry[] {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT * FROM sync_queue WHERE status IN ('pending', 'failed')
       AND retry_count < max_retries
       ORDER BY created_at ASC`,
    ) as Record<string, unknown>[];

    return rows.map(mapRow);
  }

  markMutationInFlight(id: number): void {
    const db = this.getDb();
    db.runSync(
      `UPDATE sync_queue SET status = 'in_flight', updated_at = datetime('now') WHERE id = ?`,
      [id],
    );
  }

  markMutationCompleted(id: number): void {
    const db = this.getDb();
    db.runSync(
      `UPDATE sync_queue SET status = 'completed', updated_at = datetime('now') WHERE id = ?`,
      [id],
    );
  }

  markMutationFailed(id: number, errorMessage: string): void {
    const db = this.getDb();
    db.runSync(
      `UPDATE sync_queue SET status = 'failed', error_message = ?, retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?`,
      [errorMessage, id],
    );
  }

  getSyncStats(): SyncStats {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT status, COUNT(*) as count FROM sync_queue
       WHERE status != 'completed'
       GROUP BY status`,
    ) as { status: string; count: number }[];

    const stats: SyncStats = { pending: 0, failed: 0, inFlight: 0 };
    for (const row of rows) {
      if (row.status === "pending") stats.pending = row.count;
      else if (row.status === "failed") stats.failed = row.count;
      else if (row.status === "in_flight") stats.inFlight = row.count;
    }
    return stats;
  }

  pruneCompletedMutations(olderThanHours = 24): void {
    const db = this.getDb();
    db.runSync(
      `DELETE FROM sync_queue WHERE status = 'completed'
       AND updated_at < datetime('now', ?)`,
      [`-${olderThanHours} hours`],
    );
  }

  // -- Sync Metadata --

  getLastSyncedAt(entityType: string): string | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT last_synced_at FROM sync_metadata WHERE entity_type = ?`,
      [entityType],
    ) as { last_synced_at: string }[];
    return rows.length > 0 ? rows[0].last_synced_at : null;
  }

  setLastSyncedAt(entityType: string, timestamp: string): void {
    const db = this.getDb();
    db.runSync(
      `INSERT INTO sync_metadata (entity_type, last_synced_at) VALUES (?, ?)
       ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = ?, sync_version = sync_version + 1`,
      [entityType, timestamp, timestamp],
    );
  }

  // -- Exercise Cache --

  getCachedExercises(filters?: ExerciseFilters): Exercise[] {
    const db = this.getDb();
    const rows = db.getAllSync(`SELECT data FROM cached_exercises`) as {
      data: string;
    }[];

    const exercises = rows.map((row) => JSON.parse(row.data) as Exercise);
    if (!filters) return exercises;
    return filterExercises(exercises, filters);
  }

  cacheExercises(exercises: Exercise[]): void {
    if (exercises.length === 0) return;
    const db = this.getDb();
    db.withTransactionSync(() => {
      for (const exercise of exercises) {
        db.runSync(
          `INSERT INTO cached_exercises (id, data, synced_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET data = excluded.data, synced_at = excluded.synced_at`,
          [exercise.id, JSON.stringify(exercise)],
        );
      }
    });
  }

  getCachedExercise(id: string): Exercise | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT data FROM cached_exercises WHERE id = ? LIMIT 1`,
      [id],
    ) as { data: string }[];
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].data) as Exercise;
  }

  getExerciseCacheAge(): string | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT MIN(synced_at) as oldest FROM cached_exercises`,
    ) as { oldest: string | null }[];
    return rows[0]?.oldest ?? null;
  }

  saveCustomExercise(exercise: Exercise): void {
    const db = this.getDb();
    db.runSync(
      `INSERT INTO cached_exercises (id, data, synced_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, synced_at = excluded.synced_at`,
      [exercise.id, JSON.stringify({ ...exercise, isCustom: true })],
    );
  }

  removeCachedExercise(id: string): void {
    const db = this.getDb();
    db.runSync(`DELETE FROM cached_exercises WHERE id = ?`, [id]);
  }

  // -- Reference-List Cache --

  getCachedReferenceList(kind: ReferenceListKind): ReferenceList | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT kind, entries, synced_at FROM reference_lists WHERE kind = ?`,
      [kind],
    ) as { kind: ReferenceListKind; entries: string; synced_at: string }[];
    const row = rows[0];
    if (!row) return null;
    return {
      kind: row.kind,
      entries: JSON.parse(row.entries) as ReferenceEntry[],
      syncedAt: row.synced_at,
    };
  }

  cacheReferenceList(kind: ReferenceListKind, entries: ReferenceEntry[]): void {
    const db = this.getDb();
    const syncedAt = new Date().toISOString();
    db.runSync(
      `INSERT INTO reference_lists (kind, entries, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(kind) DO UPDATE SET entries = excluded.entries, synced_at = excluded.synced_at`,
      [kind, JSON.stringify(entries), syncedAt],
    );
  }

  getReferenceListAge(kind: ReferenceListKind): string | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT synced_at FROM reference_lists WHERE kind = ?`,
      [kind],
    ) as { synced_at: string }[];
    return rows[0]?.synced_at ?? null;
  }

  // -- Workouts Cache (M2) --

  getCachedWorkoutsList(
    userId: string,
    type: WorkoutListType,
  ): CachedWorkoutsList | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT user_id, type, payload, quota, synced_at FROM cached_workouts
       WHERE user_id = ? AND type = ?`,
      [userId, type],
    ) as {
      user_id: string;
      type: WorkoutListType;
      payload: string;
      quota: string | null;
      synced_at: string;
    }[];
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      type: row.type,
      workouts: JSON.parse(row.payload) as Workout[],
      quota: row.quota ? (JSON.parse(row.quota) as WorkoutQuota) : null,
      syncedAt: row.synced_at,
    };
  }

  cacheWorkoutsList(
    userId: string,
    type: WorkoutListType,
    workouts: Workout[],
    quota: WorkoutQuota | null,
  ): void {
    const db = this.getDb();
    const syncedAt = new Date().toISOString();
    db.runSync(
      `INSERT INTO cached_workouts (user_id, type, payload, quota, synced_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, type) DO UPDATE SET
         payload = excluded.payload,
         quota = excluded.quota,
         synced_at = excluded.synced_at`,
      [
        userId,
        type,
        JSON.stringify(workouts),
        quota ? JSON.stringify(quota) : null,
        syncedAt,
      ],
    );
  }

  getWorkoutsListAge(userId: string, type: WorkoutListType): string | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT synced_at FROM cached_workouts WHERE user_id = ? AND type = ?`,
      [userId, type],
    ) as { synced_at: string }[];
    return rows[0]?.synced_at ?? null;
  }

  getCachedWorkoutDetail(
    userId: string,
    workoutId: string,
  ): CachedWorkoutDetail | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT user_id, workout_id, payload, synced_at FROM cached_workout_detail
       WHERE user_id = ? AND workout_id = ?`,
      [userId, workoutId],
    ) as {
      user_id: string;
      workout_id: string;
      payload: string;
      synced_at: string;
    }[];
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      workoutId: row.workout_id,
      workout: JSON.parse(row.payload) as Workout,
      syncedAt: row.synced_at,
    };
  }

  cacheWorkoutDetail(userId: string, workout: Workout): void {
    const db = this.getDb();
    const syncedAt = new Date().toISOString();
    db.runSync(
      `INSERT INTO cached_workout_detail (user_id, workout_id, payload, synced_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, workout_id) DO UPDATE SET
         payload = excluded.payload,
         synced_at = excluded.synced_at`,
      [userId, workout.id, JSON.stringify(workout), syncedAt],
    );
  }

  removeCachedWorkout(userId: string, workoutId: string): void {
    const db = this.getDb();
    db.withTransactionSync(() => {
      db.runSync(
        `DELETE FROM cached_workout_detail WHERE user_id = ? AND workout_id = ?`,
        [userId, workoutId],
      );
      // List slices store full payloads; rewrite the slice without the row.
      const slices = db.getAllSync(
        `SELECT type, payload, quota, synced_at FROM cached_workouts WHERE user_id = ?`,
        [userId],
      ) as {
        type: WorkoutListType;
        payload: string;
        quota: string | null;
        synced_at: string;
      }[];
      for (const slice of slices) {
        const list = JSON.parse(slice.payload) as Workout[];
        const filtered = list.filter((w) => w.id !== workoutId);
        if (filtered.length === list.length) continue;
        db.runSync(
          `UPDATE cached_workouts SET payload = ? WHERE user_id = ? AND type = ?`,
          [JSON.stringify(filtered), userId, slice.type],
        );
      }
    });
  }

  // -- Dashboard Cache (M1) --

  getCachedDashboard(userId: string): CachedDashboard | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT user_id, payload, synced_at FROM cached_dashboard WHERE user_id = ?`,
      [userId],
    ) as { user_id: string; payload: string; synced_at: string }[];
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      payload: JSON.parse(row.payload) as DashboardPayload,
      syncedAt: row.synced_at,
    };
  }

  cacheDashboard(userId: string, payload: DashboardPayload): void {
    const db = this.getDb();
    const syncedAt = new Date().toISOString();
    db.runSync(
      `INSERT INTO cached_dashboard (user_id, payload, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at`,
      [userId, JSON.stringify(payload), syncedAt],
    );
  }

  getDashboardAge(userId: string): string | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT synced_at FROM cached_dashboard WHERE user_id = ?`,
      [userId],
    ) as { synced_at: string }[];
    return rows[0]?.synced_at ?? null;
  }

  clearAll(): void {
    const db = this.getDb();
    db.execSync(`
      DELETE FROM sync_queue;
      DELETE FROM cached_workouts;
      DELETE FROM cached_workout_detail;
      DELETE FROM cached_exercises;
      DELETE FROM active_session;
      DELETE FROM sync_metadata;
      DELETE FROM reference_lists;
      DELETE FROM cached_dashboard;
    `);
  }
}

function mapRow(row: Record<string, unknown>): SyncQueueEntry {
  return {
    id: row.id as number,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string | null,
    operation: row.operation as SyncOperation,
    payload: row.payload as string,
    endpoint: row.endpoint as string,
    method: row.method as string,
    status: row.status as SyncStatus,
    retryCount: row.retry_count as number,
    maxRetries: row.max_retries as number,
    errorMessage: row.error_message as string | null,
    createdAt: row.created_at as string,
  };
}
