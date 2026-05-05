import * as SQLite from "expo-sqlite";
import type {
  CachedDashboard,
  DashboardPayload,
} from "@/domain/models/dashboard";
import type { Exercise, ExerciseFilters } from "@/domain/models/exercise";
import type { PersonalRecord, RecordType } from "@/domain/models/record";
import type {
  ReferenceEntry,
  ReferenceList,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import type {
  ExerciseSet,
  SessionExercise,
  SessionStatus,
  WorkoutSession,
} from "@/domain/models/session";
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
  RestTimerState,
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

      -- M3: drops the pre-M3 single-blob placeholder. No production data
      -- to migrate (mobile is pre-launch). See EXECUTION_PLAN.md § 1.
      DROP TABLE IF EXISTS active_session;

      -- M3: active session — normalized 3-table layout matching the wire
      -- shape. Single-active-session invariant per user (enforced via
      -- the (user_id, status) index + status='in_progress' filter).
      -- rest_timer_* columns are dead until commit 5 wires up the hook;
      -- the schema is shipped here so commit 5 doesn't need an ALTER.
      CREATE TABLE IF NOT EXISTS active_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        workout_id TEXT,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        notes TEXT,
        rest_timer_started_at TEXT,
        rest_timer_total_seconds INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS active_sessions_user_status
        ON active_sessions(user_id, status);

      CREATE TABLE IF NOT EXISTS session_exercises (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES active_sessions(id) ON DELETE CASCADE,
        exercise_id TEXT NOT NULL,
        exercise_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        superset_group INTEGER,
        is_substituted INTEGER NOT NULL DEFAULT 0,
        original_exercise_id TEXT,
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS session_exercises_session
        ON session_exercises(session_id, sort_order);

      CREATE TABLE IF NOT EXISTS exercise_sets (
        id TEXT PRIMARY KEY,
        session_exercise_id TEXT NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
        set_number INTEGER NOT NULL,
        weight_kg REAL,
        reps INTEGER,
        rpe INTEGER,
        duration_seconds INTEGER,
        distance_meters REAL,
        is_completed INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS exercise_sets_session_exercise
        ON exercise_sets(session_exercise_id, set_number);

      CREATE TABLE IF NOT EXISTS personal_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        exercise_name TEXT NOT NULL,
        record_type TEXT NOT NULL,
        value REAL NOT NULL,
        session_id TEXT,
        set_id TEXT,
        achieved_at TEXT NOT NULL,
        UNIQUE(user_id, exercise_id, record_type)
      );
      CREATE INDEX IF NOT EXISTS personal_records_user_exercise
        ON personal_records(user_id, exercise_id);

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

  invalidateDashboard(userId: string): void {
    const db = this.getDb();
    db.runSync(`DELETE FROM cached_dashboard WHERE user_id = ?`, [userId]);
  }

  // -- Active Session (M3) --

  getActiveSession(userId: string): WorkoutSession | null {
    const db = this.getDb();
    const sessionRows = db.getAllSync(
      `SELECT id, user_id, workout_id, name, status, started_at, completed_at, notes
       FROM active_sessions
       WHERE user_id = ? AND status = 'in_progress'
       LIMIT 1`,
      [userId],
    ) as ActiveSessionRow[];
    const sessionRow = sessionRows[0];
    if (!sessionRow) return null;

    const exerciseRows = db.getAllSync(
      `SELECT id, session_id, exercise_id, exercise_name, sort_order,
              superset_group, is_substituted, original_exercise_id, notes
       FROM session_exercises
       WHERE session_id = ?
       ORDER BY sort_order ASC`,
      [sessionRow.id],
    ) as SessionExerciseRow[];

    const exerciseIds = exerciseRows.map((r) => r.id);
    const setRowsByExercise = new Map<string, ExerciseSetRow[]>();
    if (exerciseIds.length > 0) {
      const placeholders = exerciseIds.map(() => "?").join(", ");
      const setRows = db.getAllSync(
        `SELECT id, session_exercise_id, set_number, weight_kg, reps, rpe,
                duration_seconds, distance_meters, is_completed, completed_at
         FROM exercise_sets
         WHERE session_exercise_id IN (${placeholders})
         ORDER BY set_number ASC`,
        exerciseIds,
      ) as ExerciseSetRow[];
      for (const row of setRows) {
        const existing = setRowsByExercise.get(row.session_exercise_id) ?? [];
        existing.push(row);
        setRowsByExercise.set(row.session_exercise_id, existing);
      }
    }

    const exercises: SessionExercise[] = exerciseRows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      exerciseId: row.exercise_id,
      exerciseName: row.exercise_name,
      sortOrder: row.sort_order,
      supersetGroup: row.superset_group,
      isSubstituted: row.is_substituted === 1,
      originalExerciseId: row.original_exercise_id,
      notes: row.notes,
      sets: (setRowsByExercise.get(row.id) ?? []).map(toExerciseSet),
    }));

    return {
      id: sessionRow.id,
      userId: sessionRow.user_id,
      workoutId: sessionRow.workout_id,
      name: sessionRow.name,
      status: sessionRow.status as SessionStatus,
      startedAt: sessionRow.started_at,
      completedAt: sessionRow.completed_at,
      notes: sessionRow.notes,
      exercises,
    };
  }

  cacheActiveSession(userId: string, session: WorkoutSession): void {
    const db = this.getDb();
    const now = new Date().toISOString();
    db.withTransactionSync(() => {
      // Wipe any prior in-progress session for the user. Single-active-
      // session invariant: cacheActiveSession replaces, never appends.
      const prior = db.getAllSync(
        `SELECT id FROM active_sessions
         WHERE user_id = ? AND id != ? AND status = 'in_progress'`,
        [userId, session.id],
      ) as { id: string }[];
      for (const row of prior) {
        db.runSync(`DELETE FROM active_sessions WHERE id = ?`, [row.id]);
      }

      db.runSync(
        `INSERT INTO active_sessions
           (id, user_id, workout_id, name, status, started_at, completed_at,
            notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           user_id = excluded.user_id,
           workout_id = excluded.workout_id,
           name = excluded.name,
           status = excluded.status,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at,
           notes = excluded.notes,
           updated_at = excluded.updated_at`,
        [
          session.id,
          userId,
          session.workoutId,
          session.name,
          session.status,
          session.startedAt,
          session.completedAt,
          session.notes,
          now,
          now,
        ],
      );

      // Replace nested rows wholesale — full upsert per
      // EXECUTION_PLAN § 3.4. Cascade handles old set rows.
      db.runSync(`DELETE FROM session_exercises WHERE session_id = ?`, [
        session.id,
      ]);

      for (const ex of session.exercises) {
        db.runSync(
          `INSERT INTO session_exercises
             (id, session_id, exercise_id, exercise_name, sort_order,
              superset_group, is_substituted, original_exercise_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ex.id,
            session.id,
            ex.exerciseId,
            ex.exerciseName,
            ex.sortOrder,
            ex.supersetGroup,
            ex.isSubstituted ? 1 : 0,
            ex.originalExerciseId,
            ex.notes,
          ],
        );
        for (const set of ex.sets) {
          db.runSync(
            `INSERT INTO exercise_sets
               (id, session_exercise_id, set_number, weight_kg, reps, rpe,
                duration_seconds, distance_meters, is_completed, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              set.id,
              ex.id,
              set.setNumber,
              set.weightKg,
              set.reps,
              set.rpe,
              set.durationSeconds,
              set.distanceMeters,
              set.isCompleted ? 1 : 0,
              set.completedAt,
            ],
          );
        }
      }
    });
  }

  clearActiveSession(userId: string): void {
    const db = this.getDb();
    db.runSync(
      `DELETE FROM active_sessions WHERE user_id = ? AND status = 'in_progress'`,
      [userId],
    );
  }

  getSessionSets(
    userId: string,
    sessionId: string,
    exerciseId: string,
  ): ExerciseSet[] {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT s.id, s.session_exercise_id, s.set_number, s.weight_kg, s.reps,
              s.rpe, s.duration_seconds, s.distance_meters, s.is_completed,
              s.completed_at
       FROM exercise_sets s
       INNER JOIN session_exercises se ON s.session_exercise_id = se.id
       INNER JOIN active_sessions a ON se.session_id = a.id
       WHERE a.user_id = ? AND a.id = ? AND se.exercise_id = ?
       ORDER BY se.sort_order ASC, s.set_number ASC`,
      [userId, sessionId, exerciseId],
    ) as ExerciseSetRow[];
    return rows.map(toExerciseSet);
  }

  cachePersonalRecords(userId: string, records: PersonalRecord[]): void {
    if (records.length === 0) return;
    const db = this.getDb();
    db.withTransactionSync(() => {
      for (const rec of records) {
        db.runSync(
          `INSERT INTO personal_records
             (id, user_id, exercise_id, exercise_name, record_type, value,
              session_id, set_id, achieved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, exercise_id, record_type) DO UPDATE SET
             id = excluded.id,
             exercise_name = excluded.exercise_name,
             value = excluded.value,
             session_id = excluded.session_id,
             set_id = excluded.set_id,
             achieved_at = excluded.achieved_at`,
          [
            rec.id,
            userId,
            rec.exerciseId,
            rec.exerciseName,
            rec.recordType,
            rec.value,
            rec.sessionId,
            rec.setId,
            rec.achievedAt,
          ],
        );
      }
    });
  }

  getPersonalRecords(userId: string, exerciseId?: string): PersonalRecord[] {
    const db = this.getDb();
    const rows = exerciseId
      ? (db.getAllSync(
          `SELECT id, user_id, exercise_id, exercise_name, record_type, value,
                  session_id, set_id, achieved_at
           FROM personal_records
           WHERE user_id = ? AND exercise_id = ?
           ORDER BY achieved_at DESC`,
          [userId, exerciseId],
        ) as PersonalRecordRow[])
      : (db.getAllSync(
          `SELECT id, user_id, exercise_id, exercise_name, record_type, value,
                  session_id, set_id, achieved_at
           FROM personal_records
           WHERE user_id = ?
           ORDER BY achieved_at DESC`,
          [userId],
        ) as PersonalRecordRow[]);
    return rows.map(toPersonalRecord);
  }

  swapLocalSessionId(localId: string, serverId: string): void {
    if (localId === serverId) return;
    const db = this.getDb();
    db.withTransactionSync(() => {
      db.runSync(`UPDATE active_sessions SET id = ? WHERE id = ?`, [
        serverId,
        localId,
      ]);
      // FK ON UPDATE is not declared; rewrite child references explicitly.
      db.runSync(
        `UPDATE session_exercises SET session_id = ? WHERE session_id = ?`,
        [serverId, localId],
      );
      db.runSync(
        `UPDATE personal_records SET session_id = ? WHERE session_id = ?`,
        [serverId, localId],
      );
    });
  }

  getRestTimerState(userId: string): RestTimerState | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT rest_timer_started_at, rest_timer_total_seconds
       FROM active_sessions
       WHERE user_id = ? AND status = 'in_progress'
       LIMIT 1`,
      [userId],
    ) as {
      rest_timer_started_at: string | null;
      rest_timer_total_seconds: number | null;
    }[];
    const row = rows[0];
    if (
      !row ||
      !row.rest_timer_started_at ||
      row.rest_timer_total_seconds == null
    ) {
      return null;
    }
    return {
      startedAt: row.rest_timer_started_at,
      totalSeconds: row.rest_timer_total_seconds,
    };
  }

  setRestTimerState(userId: string, state: RestTimerState): void {
    const db = this.getDb();
    db.runSync(
      `UPDATE active_sessions
       SET rest_timer_started_at = ?, rest_timer_total_seconds = ?,
           updated_at = ?
       WHERE user_id = ? AND status = 'in_progress'`,
      [state.startedAt, state.totalSeconds, new Date().toISOString(), userId],
    );
  }

  clearRestTimerState(userId: string): void {
    const db = this.getDb();
    db.runSync(
      `UPDATE active_sessions
       SET rest_timer_started_at = NULL, rest_timer_total_seconds = NULL,
           updated_at = ?
       WHERE user_id = ? AND status = 'in_progress'`,
      [new Date().toISOString(), userId],
    );
  }

  clearAll(): void {
    const db = this.getDb();
    db.execSync(`
      DELETE FROM sync_queue;
      DELETE FROM cached_workouts;
      DELETE FROM cached_workout_detail;
      DELETE FROM cached_exercises;
      DELETE FROM active_sessions;
      DELETE FROM session_exercises;
      DELETE FROM exercise_sets;
      DELETE FROM personal_records;
      DELETE FROM sync_metadata;
      DELETE FROM reference_lists;
      DELETE FROM cached_dashboard;
    `);
  }
}

type ActiveSessionRow = {
  id: string;
  user_id: string;
  workout_id: string | null;
  name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
};

type SessionExerciseRow = {
  id: string;
  session_id: string;
  exercise_id: string;
  exercise_name: string;
  sort_order: number;
  superset_group: number | null;
  is_substituted: number;
  original_exercise_id: string | null;
  notes: string | null;
};

type ExerciseSetRow = {
  id: string;
  session_exercise_id: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  is_completed: number;
  completed_at: string | null;
};

type PersonalRecordRow = {
  id: string;
  user_id: string;
  exercise_id: string;
  exercise_name: string;
  record_type: string;
  value: number;
  session_id: string | null;
  set_id: string | null;
  achieved_at: string;
};

function toExerciseSet(row: ExerciseSetRow): ExerciseSet {
  return {
    id: row.id,
    sessionExerciseId: row.session_exercise_id,
    setNumber: row.set_number,
    weightKg: row.weight_kg,
    reps: row.reps,
    rpe: row.rpe,
    durationSeconds: row.duration_seconds,
    distanceMeters: row.distance_meters,
    isCompleted: row.is_completed === 1,
    completedAt: row.completed_at,
  };
}

function toPersonalRecord(row: PersonalRecordRow): PersonalRecord {
  return {
    id: row.id,
    userId: row.user_id,
    exerciseId: row.exercise_id,
    exerciseName: row.exercise_name,
    recordType: row.record_type as RecordType,
    value: row.value,
    sessionId: row.session_id,
    setId: row.set_id,
    achievedAt: row.achieved_at,
  };
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
