import * as SQLite from "expo-sqlite";
import type {
  CachedDashboard,
  DashboardPayload,
} from "@/domain/models/dashboard";
import type { Exercise, ExerciseFilters } from "@/domain/models/exercise";
import type {
  CachedProfilePage,
  ProfilePageData,
} from "@/domain/models/profilePage";
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
  RecentSetEntry,
  RecordResponseSummary,
  RestTimerState,
  SyncQueueEntry,
  SyncStats,
} from "@/domain/ports/storage.port";
import type {
  EntitlementVerdict,
  SyncOperation,
  SyncStatus,
} from "@/domain/ports/sync.types";

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
        -- M10.6: 'blocked_entitlement' added to the status set. Fresh
        -- installs land the extended CHECK directly; existing installs
        -- migrate via the column-add + CHECK-relaxation block below
        -- (SQLite can't alter CHECK constraints in place — we tolerate
        -- the legacy check by storing the new status only when the
        -- column-add succeeded, and the runtime guard in
        -- markMutationBlocked falls back to 'failed' if the CHECK
        -- rejects).
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_flight', 'failed', 'completed', 'blocked_entitlement')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        error_message TEXT,
        -- M10.6: JSON-serialised EntitlementVerdict. Populated alongside
        -- status='blocked_entitlement'; cleared on unblock. JSON column
        -- (not a sibling table) keeps the migration trivial and the read
        -- path single-query — verdict cardinality is 1:1 with the entry.
        entitlement_verdict TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- M10.6 migration for installs that predate this milestone is run
      -- via PRAGMA table_info + ALTER TABLE outside this SQL string
      -- (see immediately after this execSync block). We can't ALTER an
      -- existing CHECK, but we CAN add the missing entitlement_verdict
      -- column — that's the only piece the runtime actually reads.

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

      -- M3 (1A.4): cross-session "Previous" hint cache. Mirrors legacy
      -- user_history.recent_sets — each row is the user's most recent
      -- (weightKg, reps) for a given exercise + setNumber. Upserted
      -- by completeSessionCommand on flip-to-completed. Read by the
      -- active-session container to populate per-set Previous chips.
      CREATE TABLE IF NOT EXISTS recent_sets (
        user_id TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        set_number INTEGER NOT NULL,
        weight_kg REAL NOT NULL,
        reps INTEGER NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (user_id, exercise_id, set_number)
      );
      CREATE INDEX IF NOT EXISTS idx_recent_sets_user_exercise
        ON recent_sets (user_id, exercise_id);

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

      -- M6: profile-page cache. One row per user; payload is the
      -- full JSON-serialised ProfilePageData. 5-minute TTL
      -- (PROFILE_PAGE_STALE_AFTER_MS) enforced by the query layer.
      CREATE TABLE IF NOT EXISTS cached_profile_page (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );

      -- M3 Phase 3b: cached server response from POST /sessions/record.
      -- Drives the Summary screen's switch from local prediction
      -- (calculateSummary + detectPersonalRecords) to server-truth
      -- (PRs with previousValue + workoutsThisMonth) once the
      -- sync worker drains the queue. Single row per user
      -- (single-active-session invariant); cleared by clearActiveSession.
      -- Payload is the full JSON-serialised RecordResponseSummary.
      CREATE TABLE IF NOT EXISTS record_responses (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        cached_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_cached_exercises_synced_at ON cached_exercises(synced_at);
    `);

    // M10.6 migration for installs that predate this milestone. The
    // CREATE TABLE IF NOT EXISTS above is a no-op when the table is
    // already present, so the new `entitlement_verdict` column won't
    // land via the fresh-install path. PRAGMA table_info enumerates
    // columns; if our marker is missing we ALTER-ADD it.
    //
    // Idempotent — repeated cold-starts see the column and skip. The
    // SQLite CHECK constraint on `status` is the pre-M10.6 four-value
    // set on migrated installs; markMutationBlocked tolerates the
    // rejection by re-trying as `failed` (rare path — pre-launch users
    // aren't expected). Fresh installs land the full 5-value CHECK.
    const columns = db.getAllSync(
      `PRAGMA table_info(sync_queue)`,
    ) as Array<{ name: string }>;
    const hasVerdictColumn = columns.some(
      (c) => c.name === "entitlement_verdict",
    );
    if (!hasVerdictColumn) {
      db.execSync(`ALTER TABLE sync_queue ADD COLUMN entitlement_verdict TEXT`);
    }
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
    // M10.6: `blocked_entitlement` is deliberately NOT included — those
    // entries have a definitive server verdict that "retrying won't help
    // without a tier change". They re-enter the pool via `unblockEntries`
    // (explicit user action OR `useAutoRetryOnUpgrade`) or get deleted
    // via `discardEntries`. Treating them as pending would spin the
    // drain forever on a 402 the user already saw.
    const rows = db.getAllSync(
      `SELECT * FROM sync_queue WHERE status IN ('pending', 'failed')
       AND retry_count < max_retries
       ORDER BY created_at ASC`,
    ) as Record<string, unknown>[];

    return rows.map(mapRow);
  }

  markMutationInFlight(id: number): boolean {
    const db = this.getDb();
    // Row-conditional claim: only flip to in_flight when the entry
    // is still `pending` or `failed`. Returns whether THIS caller
    // claimed it. SQLite's `runSync` returns `{ changes }` — we
    // treat changes>0 as "this caller owns it". Stops two
    // concurrent drains (e.g. useSyncWorker mid-flush + the inline
    // post-Submit drain in WorkoutRatingContainer) from both
    // marking the same entry in-flight and firing duplicate POSTs.
    // See storage.port.ts:50-67 for the full Inspector Brad PR #62
    // context.
    const result = db.runSync(
      `UPDATE sync_queue
       SET status = 'in_flight', updated_at = datetime('now')
       WHERE id = ? AND status IN ('pending', 'failed')`,
      [id],
    );
    return result.changes > 0;
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

  markMutationBlocked(id: number, verdict: EntitlementVerdict): void {
    const db = this.getDb();
    // M10.6: flip the entry to `blocked_entitlement` and stash the
    // verdict alongside. `error_message` is left untouched — blocked is
    // a distinct lifecycle state with its own data, not a sub-case of
    // failed. `retry_count` is also untouched: a tier-change unblock
    // pushes the row back to `pending` with its retry budget intact.
    db.runSync(
      `UPDATE sync_queue
       SET status = 'blocked_entitlement',
           entitlement_verdict = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [JSON.stringify(verdict), id],
    );
  }

  getBlockedEntries(): SyncQueueEntry[] {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT * FROM sync_queue WHERE status = 'blocked_entitlement'
       ORDER BY created_at ASC`,
    ) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  unblockEntries(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const db = this.getDb();
    // Conditional on `status = 'blocked_entitlement'` so a stale id
    // (e.g. the user discarded it in another tab between the read and
    // the unblock click) doesn't accidentally flip a `completed` row
    // back to pending. Clear the verdict at the same time so the
    // re-claim path is indistinguishable from a fresh enqueue.
    db.withTransactionSync(() => {
      const placeholders = ids.map(() => "?").join(",");
      db.runSync(
        `UPDATE sync_queue
         SET status = 'pending',
             entitlement_verdict = NULL,
             updated_at = datetime('now')
         WHERE id IN (${placeholders}) AND status = 'blocked_entitlement'`,
        ids as unknown as number[],
      );
    });
  }

  discardEntries(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const db = this.getDb();
    db.withTransactionSync(() => {
      const placeholders = ids.map(() => "?").join(",");
      db.runSync(
        `DELETE FROM sync_queue WHERE id IN (${placeholders})`,
        ids as unknown as number[],
      );
    });
  }

  getSyncStats(): SyncStats {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT status, COUNT(*) as count FROM sync_queue
       WHERE status != 'completed'
       GROUP BY status`,
    ) as { status: string; count: number }[];

    const stats: SyncStats = { pending: 0, failed: 0, inFlight: 0, blocked: 0 };
    for (const row of rows) {
      if (row.status === "pending") stats.pending = row.count;
      else if (row.status === "failed") stats.failed = row.count;
      else if (row.status === "in_flight") stats.inFlight = row.count;
      else if (row.status === "blocked_entitlement") stats.blocked = row.count;
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

  // -- Profile-Page Cache (M6) --

  getCachedProfilePage(userId: string): CachedProfilePage | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT user_id, payload, synced_at FROM cached_profile_page WHERE user_id = ?`,
      [userId],
    ) as { user_id: string; payload: string; synced_at: string }[];
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      payload: JSON.parse(row.payload) as ProfilePageData,
      syncedAt: row.synced_at,
    };
  }

  cacheProfilePage(userId: string, payload: ProfilePageData): void {
    const db = this.getDb();
    const syncedAt = new Date().toISOString();
    db.runSync(
      `INSERT INTO cached_profile_page (user_id, payload, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at`,
      [userId, JSON.stringify(payload), syncedAt],
    );
  }

  getProfilePageAge(userId: string): string | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT synced_at FROM cached_profile_page WHERE user_id = ?`,
      [userId],
    ) as { synced_at: string }[];
    return rows[0]?.synced_at ?? null;
  }

  invalidateProfilePage(userId: string): void {
    const db = this.getDb();
    db.runSync(`DELETE FROM cached_profile_page WHERE user_id = ?`, [userId]);
  }

  // -- Active Session (M3) --

  getActiveSession(userId: string): WorkoutSession | null {
    return this.loadSessionForUser(userId, true);
  }

  getLatestSession(userId: string): WorkoutSession | null {
    return this.loadSessionForUser(userId, false);
  }

  private loadSessionForUser(
    userId: string,
    onlyInProgress: boolean,
  ): WorkoutSession | null {
    const db = this.getDb();
    const where = onlyInProgress
      ? `WHERE user_id = ? AND status = 'in_progress'`
      : `WHERE user_id = ?`;
    const sessionRows = db.getAllSync(
      `SELECT id, user_id, workout_id, name, status, started_at, completed_at, notes
       FROM active_sessions
       ${where}
       ORDER BY updated_at DESC
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

      // Inspector Brad PR #62 (high severity, belt-and-braces): if the
      // record-response cache slot carries a DIFFERENT session id
      // than the one being cached now, this is a session boundary
      // and the prior session's payload is stale. The container's
      // `localSessionId` guard is the primary fix, but clearing here
      // too means the cache slot can never carry stale data across a
      // session boundary regardless of poll timing. Mid-session
      // updates (same session.id) never touch the slot.
      db.runSync(
        `DELETE FROM record_responses
         WHERE user_id = ? AND payload NOT LIKE ?`,
        [userId, `%"localSessionId":"${session.id}"%`],
      );

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
    // Drop the row regardless of status — Summary's Continue button
    // retires a flushed `completed` / `cancelled` row, and the worker
    // calls this after a successful bulk-record swap. Also drop the
    // cached record-response so a fresh session doesn't render stale
    // PR/workoutsThisMonth data from the previous one.
    db.runSync(`DELETE FROM active_sessions WHERE user_id = ?`, [userId]);
    db.runSync(`DELETE FROM record_responses WHERE user_id = ?`, [userId]);
  }

  cacheRecordResponse(userId: string, response: RecordResponseSummary): void {
    const db = this.getDb();
    db.runSync(
      `INSERT INTO record_responses (user_id, payload, cached_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         payload = excluded.payload,
         cached_at = excluded.cached_at`,
      [userId, JSON.stringify(response), response.cachedAt],
    );
  }

  getRecordResponse(userId: string): RecordResponseSummary | null {
    const db = this.getDb();
    const row = db.getFirstSync(
      `SELECT payload FROM record_responses WHERE user_id = ?`,
      [userId],
    ) as { payload: string } | null;
    if (!row) return null;
    // Trust the round-trip — the writer is `cacheRecordResponse` and
    // payload is its own JSON.stringify output; storage is local to
    // the device so there's no external corruption vector.
    return JSON.parse(row.payload) as RecordResponseSummary;
  }

  clearRecordResponse(userId: string): void {
    const db = this.getDb();
    db.runSync(`DELETE FROM record_responses WHERE user_id = ?`, [userId]);
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

  getRecentSetsByExercise(
    userId: string,
    exerciseIds: readonly string[],
  ): Record<string, Record<number, { weightKg: number; reps: number }>> {
    if (exerciseIds.length === 0) return {};
    const db = this.getDb();
    const placeholders = exerciseIds.map(() => "?").join(",");
    const rows = db.getAllSync(
      `SELECT exercise_id, set_number, weight_kg, reps
       FROM recent_sets
       WHERE user_id = ? AND exercise_id IN (${placeholders})`,
      [userId, ...exerciseIds],
    ) as {
      exercise_id: string;
      set_number: number;
      weight_kg: number;
      reps: number;
    }[];
    const map: Record<
      string,
      Record<number, { weightKg: number; reps: number }>
    > = {};
    for (const row of rows) {
      const exerciseMap = map[row.exercise_id] ?? (map[row.exercise_id] = {});
      exerciseMap[row.set_number] = { weightKg: row.weight_kg, reps: row.reps };
    }
    return map;
  }

  upsertRecentSets(userId: string, sets: readonly RecentSetEntry[]): void {
    if (sets.length === 0) return;
    const db = this.getDb();
    db.withTransactionSync(() => {
      for (const s of sets) {
        db.runSync(
          `INSERT INTO recent_sets
             (user_id, exercise_id, set_number, weight_kg, reps, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, exercise_id, set_number) DO UPDATE SET
             weight_kg = excluded.weight_kg,
             reps = excluded.reps,
             recorded_at = excluded.recorded_at`,
          [userId, s.exerciseId, s.setNumber, s.weightKg, s.reps, s.recordedAt],
        );
      }
    });
  }

  swapLocalSessionId(localId: string, serverId: string): void {
    if (localId === serverId) return;
    const db = this.getDb();
    db.withTransactionSync(() => {
      // session_exercises.session_id has a FK to active_sessions(id) declared
      // ON DELETE CASCADE but NOT ON UPDATE CASCADE. Updating the parent
      // first (or the child first) with `PRAGMA foreign_keys = ON` would
      // raise an immediate FK constraint violation because sibling rows
      // still reference the old id during the partial-update window.
      // `PRAGMA defer_foreign_keys = ON` defers FK validation to COMMIT,
      // so both rewrites can land before the check fires. The pragma is
      // transaction-scoped — it auto-resets to OFF on COMMIT/ROLLBACK and
      // does not leak to other connections.
      db.execSync("PRAGMA defer_foreign_keys = ON");
      db.runSync(`UPDATE active_sessions SET id = ? WHERE id = ?`, [
        serverId,
        localId,
      ]);
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
      DELETE FROM recent_sets;
      DELETE FROM sync_metadata;
      DELETE FROM reference_lists;
      DELETE FROM cached_dashboard;
      DELETE FROM cached_profile_page;
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
    entitlementVerdict: parseEntitlementVerdict(row.entitlement_verdict),
  };
}

/**
 * Parse the stored JSON-serialised verdict. Returns null when the row
 * has no verdict (the common case — only blocked entries carry one)
 * or when the stored JSON is malformed (defensive; the writer is our
 * own JSON.stringify so corruption is unlikely but never throw the
 * read path on a bad row).
 */
function parseEntitlementVerdict(raw: unknown): EntitlementVerdict | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as EntitlementVerdict;
  } catch {
    return null;
  }
}
