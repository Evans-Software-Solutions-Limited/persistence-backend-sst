import * as SQLite from "expo-sqlite";
import type {
  CachedDashboard,
  DashboardPayload,
} from "@/domain/models/dashboard";
import type { CoachOverview } from "@/domain/models/coachOverview";
import type { ClientDetail } from "@/domain/models/clientDetail";
import type { TrainerClient } from "@/domain/models/trainerClient";
import type { ProgramSummary } from "@/domain/models/program";
import type {
  Food,
  FuelToday,
  Meal,
  NutritionTarget,
  Recipe,
} from "@/domain/models/nutrition";
import {
  deriveExerciseOwnership,
  type Exercise,
  type ExerciseFilters,
} from "@/domain/models/exercise";
import type {
  CachedProfilePage,
  ProfilePageData,
} from "@/domain/models/profilePage";
import type { Notification } from "@/domain/models/notification";
import type { NotificationPreferences } from "@/domain/models/notification-preferences";
import { normalizePreferences } from "@/domain/models/notification-preferences";
import type { PersonalRecord, RecordType } from "@/domain/models/record";
import type {
  HomePayload,
  BodyTrendPoint,
  VolumeStats,
} from "@/domain/models/progress";
import type { Streak } from "@/domain/models/streak";
import type { Achievement } from "@/domain/models/achievement";
import type { Goal } from "@/domain/models/goal";
import type { HabitCompletion } from "@/domain/models/habit-completion";
import type { HabitConfig } from "@/domain/models/habit-config";
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
  CachedWorkoutHistory,
  CachedWorkoutsList,
  Workout,
  WorkoutHistory,
  WorkoutListType,
  WorkoutQuota,
} from "@/domain/models/workout";
import { filterExercises } from "@/domain/services/exercise.service";
import { runSqliteMigrations } from "@/adapters/storage/sqliteMigrations";
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
  private _backendChanged = false;

  private getDb(): SQLite.SQLiteDatabase {
    if (!this.db) {
      this.db = SQLite.openDatabaseSync(DB_NAME);
      this.db.execSync("PRAGMA journal_mode = WAL;");
      this.db.execSync("PRAGMA foreign_keys = ON;");
    }
    return this.db;
  }

  async initialize(backendFingerprint?: string): Promise<void> {
    const db = this.getDb();

    // One-time pre-M2 → M2 migration for `cached_workouts` (legacy flat
    // id-keyed stash → (user_id, type) list slices). SCHEMA-GUARDED: a prior
    // build ran `DROP TABLE IF EXISTS cached_workouts` UNCONDITIONALLY in the
    // execSync block below, which wiped the workouts cache on EVERY cold launch
    // — so the Train + Home lists errored offline (the only cache without a
    // usable offline copy). Only drop when the legacy flat schema is actually
    // present (its CREATE lacks the composite PK); the new-schema table is left
    // intact so it persists across launches and offline reads work.
    const wkDef = db.getFirstSync(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='cached_workouts'`,
    ) as { sql: string } | null;
    if (wkDef !== null && !wkDef.sql.includes("PRIMARY KEY (user_id, type)")) {
      db.execSync(`DROP TABLE IF EXISTS cached_workouts;`);
    }

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
        -- installs land the extended CHECK directly; legacy installs
        -- (pre-M10.6) keep the four-value CHECK until the table-rebuild
        -- migration block below runs at initialize() — it uses SQLite's
        -- documented ALTER-emulation pattern (CREATE new + INSERT
        -- SELECT + DROP + RENAME, all in a transaction) to relax the
        -- CHECK in place. Post-rebuild, every install converges on this
        -- shape and markMutationBlocked has no fallback path to worry
        -- about.
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

      -- M10.6 migration for legacy installs (pre-M10.6 schema with the
      -- 4-value CHECK) runs as a table rebuild in JS immediately after
      -- this execSync block — see the sqlite_master inspection +
      -- withTransactionSync block. Post-rebuild, every install
      -- converges on this exact schema.

      -- Pre-M2 the table was a flat keyed-by-id stash; M2 replaced it with a
      -- (user_id, type)-keyed cache of full list slices. The one-time drop of
      -- the legacy schema is SCHEMA-GUARDED in JS above (it previously ran
      -- unconditionally HERE, wiping the cache on every launch → workouts
      -- errored offline). CREATE IF NOT EXISTS preserves the populated table
      -- across launches so offline reads work.
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

      -- Workout Authoring v2 (S2): per-workout completed-session history for
      -- the detail hero. New table → CREATE IF NOT EXISTS in initialize() is
      -- safe for both fresh + existing installs (no ALTER, no migration).
      CREATE TABLE IF NOT EXISTS cached_workout_history (
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
        updated_at TEXT NOT NULL,
        -- M18 Start-live: coach on-behalf client, persisted here (the existence
        -- authority) so a force-quit → rehydrate recovers it. NULL for a normal
        -- athlete session. Idempotent ALTER below backfills existing installs.
        client_id TEXT,
        client_name TEXT,
        client_initials TEXT
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

      -- 10-trainer-features: Coach You overview cache. One row per
      -- trainer userId; payload is the full JSON-serialised CoachOverview.
      -- Same shape as cached_dashboard; staleness enforced by the hook.
      CREATE TABLE IF NOT EXISTS cached_coach_overview (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );

      -- M8 Coach Phase 5: Client Detail aggregate cache. One row per
      -- (trainer userId, clientId); payload is the full JSON-serialised
      -- ClientDetail. Keyed by BOTH ids so a coach browsing many clients keeps
      -- per-client slots and no coach's cache bleeds into another's. Staleness
      -- enforced by the hook.
      CREATE TABLE IF NOT EXISTS cached_client_detail (
        user_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, client_id)
      );

      -- 10-trainer-features: Clients roster cache. One row per trainer
      -- userId; payload is the full JSON-serialised TrainerClient[].
      -- Same shape as cached_coach_overview; staleness enforced by the hook.
      CREATE TABLE IF NOT EXISTS cached_trainer_clients (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );

      -- 19-programs (Phase 9 mobile — coach F1): Programmes list cache. One
      -- row per trainer userId; payload is the full JSON-serialised
      -- ProgramSummary[]. Same shape as cached_trainer_clients; staleness
      -- enforced by the hook. Programme DETAIL is never cached (live fetch).
      CREATE TABLE IF NOT EXISTS cached_programs (
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

      -- 09: notifications cache (100-row LRU). Not user-scoped — the
      -- cache is wiped on sign-out via clearAll, so at most one user's
      -- rows live here at a time. Matches design.md § SQLite cache
      -- schema (deep_link + data_json carried for offline deep-link
      -- dispatch; related_entity_* added so 09.6 can derive a route when
      -- data.deepLink is absent). read_at null = unread.
      CREATE TABLE IF NOT EXISTS cached_notifications (
        id                  TEXT PRIMARY KEY,
        type                TEXT NOT NULL,
        title               TEXT NOT NULL,
        body                TEXT NOT NULL,
        deep_link           TEXT,
        data_json           TEXT NOT NULL,
        related_entity_type TEXT,
        related_entity_id   TEXT,
        read_at             TEXT,
        created_at          TEXT NOT NULL
      );

      -- 09: per-type notification opt-in map for offline reads + optimistic
      -- toggles. Single row (id = 1); prefs_json is the JSON-serialised
      -- NotificationPreferences. Reset to the server's merged column when
      -- the sync queue flushes the POST.
      CREATE TABLE IF NOT EXISTS cached_notification_preferences (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        prefs_json TEXT NOT NULL,
        synced_at  TEXT NOT NULL
      );

      -- M4 (06-progress-goals): per-user JSON-blob slots, same shape as
      -- cached_dashboard. 5-min TTL enforced by the query/hook layer.
      CREATE TABLE IF NOT EXISTS cached_home (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cached_goals (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      -- Workout Authoring v2 (S3): coach Workout-library list (all authored,
      -- UNFILTERED) — a dedicated slot separate from the owner-visible-filtered
      -- cached_workouts mine slice. New table, CREATE IF NOT EXISTS is safe
      -- for fresh + existing installs.
      CREATE TABLE IF NOT EXISTS cached_coach_workout_library (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cached_streaks (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cached_achievements (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cached_body_trend (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cached_volume_stats (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );

      -- M4: row-level habit-completion cache. \`day\` is the user-local
      -- YYYY-MM-DD (computed by the optimistic writer) so deriveStreak can
      -- walk back by day without re-bucketing timestamps. One row per
      -- (user, goal, day) — the unique index makes the optimistic toggle
      -- idempotent and the sync replay safe.
      CREATE TABLE IF NOT EXISTS cached_habit_completions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        day TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        value REAL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_completions_user_goal_day
        ON cached_habit_completions(user_id, goal_id, day);

      -- 18-habit-setup: habit-config cache (design.md § 8). One row per
      -- (user, category) — the unique key makes the optimistic enable/edit
      -- idempotent and means a habit configured offline (goalId = local-…)
      -- de-dupes on category the moment the drain swaps in the server row.
      -- The whole HabitConfig is stored as a JSON payload (small, read-whole).
      CREATE TABLE IF NOT EXISTS cached_habit_configs (
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, category)
      );

      -- M9 (13-nutrition-tracking / Fuel). The day aggregate is the Fuel
      -- screen's primary read — keyed by (user_id, date) so each day rolls
      -- over independently at user-local midnight. 5-min TTL enforced by the
      -- hook layer; after an optimistic write the hook recomputes + rewrites
      -- this row so the ring updates without a round-trip.
      CREATE TABLE IF NOT EXISTS cached_fuel_today (
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, date)
      );
      -- Resolved foods for the OFFLINE barcode fallback (design.md § Offline
      -- behaviour). Keyed by id; barcode is indexed for the scan lookup. Not
      -- user-scoped (foods are shared library rows); wiped on sign-out.
      CREATE TABLE IF NOT EXISTS cached_foods (
        id TEXT PRIMARY KEY,
        barcode TEXT,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cached_foods_barcode ON cached_foods(barcode);
      -- Recipe list + detail. One row per (user_id, id); the detail upsert
      -- overwrites the list row with the fuller (ingredient-bearing) payload.
      CREATE TABLE IF NOT EXISTS cached_recipes (
        user_id TEXT NOT NULL,
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      -- Saved meal presets, one row per (user_id, id).
      CREATE TABLE IF NOT EXISTS cached_meals (
        user_id TEXT NOT NULL,
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      -- Current daily target (single small row per user).
      CREATE TABLE IF NOT EXISTS cached_nutrition_target (
        user_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_cached_exercises_synced_at ON cached_exercises(synced_at);
      CREATE INDEX IF NOT EXISTS idx_cached_notifications_created ON cached_notifications(created_at DESC);
    `);

    // M18 Start-live migration: backfill the coach on-behalf columns on
    // `active_sessions` for installs created before this milestone. The
    // CREATE TABLE IF NOT EXISTS above is a no-op on an existing table, so
    // additive columns need an explicit ALTER. Idempotent — only adds a
    // column when PRAGMA table_info shows it missing.
    const activeSessionColumns = db.getAllSync(
      `PRAGMA table_info(active_sessions)`,
    ) as { name: string }[];
    const existingNames = new Set(activeSessionColumns.map((c) => c.name));
    for (const col of ["client_id", "client_name", "client_initials"]) {
      if (!existingNames.has(col)) {
        db.execSync(`ALTER TABLE active_sessions ADD COLUMN ${col} TEXT`);
      }
    }

    // M10.6 migration for installs that predate this milestone.
    //
    // The CREATE TABLE IF NOT EXISTS above is a no-op when the table is
    // already present, so a legacy install keeps its pre-M10.6 schema:
    //   - status CHECK is the 4-value set (missing 'blocked_entitlement')
    //   - entitlement_verdict column doesn't exist
    //
    // Pre sweep #4, we tried to patch this with a column-add + runtime
    // try/catch in markMutationBlocked — but that stranded blocked
    // entries in status='failed' with retry_count burned, invisible to
    // both getBlockedEntries() and getPendingMutations(). Inspector Brad
    // sweep #4 medium-severity find — fixed via a proper table rebuild
    // using SQLite's documented ALTER-emulation pattern (see
    // https://www.sqlite.org/lang_altertable.html#otheralter).
    //
    // Detection: inspect sqlite_master.sql for the stored CREATE TABLE
    // statement. If it lacks 'blocked_entitlement', the table is on the
    // pre-M10.6 CHECK and needs rebuilding. Fresh installs always have
    // the marker (the IF NOT EXISTS landed the new schema).
    //
    // Rebuild is wrapped in withTransactionSync so a power-loss / crash
    // mid-migration rolls back atomically — no half-rebuilt state. Hot
    // read paths (markMutationBlocked, getBlockedEntries,
    // getPendingMutations) stay clean for ALL installs post-rebuild,
    // with zero ongoing predicate overhead.
    const tableDef = db.getFirstSync(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='sync_queue'`,
    ) as { sql: string } | null;
    const needsRebuild =
      tableDef !== null && !tableDef.sql.includes("blocked_entitlement");
    if (needsRebuild) {
      const sourceColumns = db.getAllSync(`PRAGMA table_info(sync_queue)`) as {
        name: string;
      }[];
      const sourceHasVerdict = sourceColumns.some(
        (c) => c.name === "entitlement_verdict",
      );
      db.withTransactionSync(() => {
        // Identical shape to the fresh-install CREATE TABLE above,
        // including the 5-value CHECK on `status` and the
        // entitlement_verdict column. Keep the two schemas in lockstep
        // — if you change one, change both.
        db.execSync(`
          CREATE TABLE sync_queue_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id TEXT,
            operation TEXT NOT NULL CHECK(operation IN ('create', 'update', 'delete')),
            payload TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            method TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_flight', 'failed', 'completed', 'blocked_entitlement')),
            retry_count INTEGER NOT NULL DEFAULT 0,
            max_retries INTEGER NOT NULL DEFAULT 3,
            error_message TEXT,
            entitlement_verdict TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);
        // Two branches because we can't reference a column on the source
        // that may not exist (legacy-pre-M10.6 doesn't have
        // entitlement_verdict). Both branches preserve `id` so existing
        // in-flight refs (e.g. mid-drain) survive the rebuild.
        if (sourceHasVerdict) {
          db.execSync(`
            INSERT INTO sync_queue_new (
              id, entity_type, entity_id, operation, payload, endpoint,
              method, status, retry_count, max_retries, error_message,
              entitlement_verdict, created_at, updated_at
            )
            SELECT
              id, entity_type, entity_id, operation, payload, endpoint,
              method, status, retry_count, max_retries, error_message,
              entitlement_verdict, created_at, updated_at
            FROM sync_queue;
          `);
        } else {
          db.execSync(`
            INSERT INTO sync_queue_new (
              id, entity_type, entity_id, operation, payload, endpoint,
              method, status, retry_count, max_retries, error_message,
              created_at, updated_at
            )
            SELECT
              id, entity_type, entity_id, operation, payload, endpoint,
              method, status, retry_count, max_retries, error_message,
              created_at, updated_at
            FROM sync_queue;
          `);
        }
        db.execSync(`DROP TABLE sync_queue`);
        db.execSync(`ALTER TABLE sync_queue_new RENAME TO sync_queue`);
        // The original index was dropped with the old table; recreate.
        db.execSync(
          `CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at)`,
        );
      });
    }

    // M13 sync-hardening (Task 4): versioned migration mechanism. Runs
    // LAST — every ad-hoc CREATE-IF-NOT-EXISTS / ALTER block above has
    // already brought this install to the latest known shape by this
    // point, so a fresh or pre-M13 install baselines here with nothing to
    // run. `SQLITE_MIGRATIONS` is empty today; future schema changes land
    // as a new entry there instead of another bespoke inline block.
    runSqliteMigrations(db);

    // Backend-fingerprint cache/session auto-wipe: stamp the cache with the
    // backend it was populated against (the compiled Supabase URL). New
    // table — CREATE IF NOT EXISTS is safe for fresh + existing installs.
    // Deliberately NOT included in clearAll()'s DELETE list — the stamp
    // must survive the wipe it triggers (and since clearAll() runs BEFORE
    // the upsert below, ordering is safe regardless).
    db.execSync(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this._backendChanged = false;
    if (backendFingerprint) {
      const row = db.getFirstSync(
        `SELECT value FROM meta WHERE key = 'backend_fingerprint'`,
      ) as { value: string } | null;
      if (row === null || row.value !== backendFingerprint) {
        // Absent stamp (first launch on an existing install post-upgrade,
        // possibly holding stale prior-backend data) OR a genuine backend
        // change — wipe the cache, flag the change for the caller (which
        // also clears the local auth session), then stamp the new value.
        //
        // ⚠ On the FIRST fingerprinted build the stamp is always absent, so
        // this fires exactly once per install. On a backend migration that's
        // precisely right (old cache + old-backend session must go); on a
        // same-backend upgrade it's a one-time wipe + re-login. Any dropped
        // sync_queue mutations targeted the prior backend and are
        // unreplayable there anyway, so losing them is acceptable.
        //
        // Wipe + stamp run in ONE transaction so a process kill between them
        // can't leave an un-stamped empty cache that re-wipes (and re-clears
        // the session) on the next launch.
        db.withTransactionSync(() => {
          this.clearAll();
          db.runSync(
            `INSERT INTO meta (key, value) VALUES ('backend_fingerprint', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [backendFingerprint],
          );
        });
        this._backendChanged = true;
      }
    }
  }

  /**
   * Whether the last `initialize()` call detected an absent/mismatched
   * backend fingerprint and wiped the cache. See storage.port.ts for the
   * full semantics.
   */
  backendChanged(): boolean {
    return this._backendChanged;
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

  updateMutationPayload(id: number, payload: unknown): void {
    const db = this.getDb();
    // Status-conditional rewrite: only a `pending`/`failed` entry can have
    // its body changed. An `in_flight` entry may already be mid-flush (its
    // body serialized into a live request), and a `completed`/blocked entry
    // is done — rewriting either would be a lost update or a phantom resend.
    // No affected-rows check needed: a no-op on a non-rewritable id is the
    // correct, safe outcome for the coalescing caller.
    db.runSync(
      `UPDATE sync_queue
       SET payload = ?, updated_at = datetime('now')
       WHERE id = ? AND status IN ('pending', 'failed')`,
      [JSON.stringify(payload), id],
    );
  }

  markMutationBlocked(id: number, verdict: EntitlementVerdict): void {
    const db = this.getDb();
    // M10.6: flip the entry to `blocked_entitlement` and stash the
    // verdict alongside. `error_message` is left untouched — blocked is
    // a distinct lifecycle state with its own data, not a sub-case of
    // failed. `retry_count` is also untouched: a tier-change unblock
    // pushes the row back to `pending` with its retry budget intact.
    //
    // No fallback needed — the table-rebuild migration in initialize()
    // guarantees the CHECK accepts 'blocked_entitlement' on every
    // install. Any throw here is a genuine bug (e.g. the id doesn't
    // exist, or the DB is corrupt) and SHOULD bubble up so
    // processSyncQueue's catch marks the entry `failed` and the next
    // drain can re-attempt or escalate.
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

  getFailedExhaustedEntries(): SyncQueueEntry[] {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT * FROM sync_queue WHERE status = 'failed' AND retry_count >= max_retries
       ORDER BY created_at ASC`,
    ) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  resetFailedEntries(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const db = this.getDb();
    // Conditional on `status = 'failed'` — mirrors `unblockEntries` — so a
    // stale id (already discarded, or claimed by a concurrent drain since
    // the caller's read) is silently skipped instead of corrupting an
    // unrelated row.
    db.withTransactionSync(() => {
      const placeholders = ids.map(() => "?").join(",");
      db.runSync(
        `UPDATE sync_queue
         SET status = 'pending',
             retry_count = 0,
             error_message = NULL,
             updated_at = datetime('now')
         WHERE id IN (${placeholders}) AND status = 'failed'`,
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

    const exercises = rows.map((row) =>
      deriveExerciseOwnership(JSON.parse(row.data) as Exercise),
    );
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
    return deriveExerciseOwnership(JSON.parse(rows[0].data) as Exercise);
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

  swapLocalExerciseId(localId: string, serverId: string): void {
    if (localId === serverId) return;
    const db = this.getDb();
    db.withTransactionSync(() => {
      // Re-key the cached row. The id lives BOTH in the PK column and inside
      // the serialized blob, so rewrite both. INSERT-then-DELETE (rather than
      // `UPDATE id`) also folds cleanly onto any row a concurrent refresh
      // already pulled under the server id.
      const rows = db.getAllSync(
        `SELECT data FROM cached_exercises WHERE id = ?`,
        [localId],
      ) as { data: string }[];
      if (rows.length > 0) {
        const exercise = JSON.parse(rows[0].data) as Exercise;
        exercise.id = serverId;
        db.runSync(
          `INSERT INTO cached_exercises (id, data, synced_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET data = excluded.data, synced_at = excluded.synced_at`,
          [serverId, JSON.stringify(exercise)],
        );
        db.runSync(`DELETE FROM cached_exercises WHERE id = ?`, [localId]);
      }
      // Re-point any queued exercise mutations still addressed to the local
      // id (e.g. a PATCH/DELETE enqueued before the create flushed) so they
      // hit the real resource instead of 404ing on `/exercises/local-…`.
      db.runSync(
        `UPDATE sync_queue SET endpoint = ?
         WHERE entity_type = 'exercise' AND endpoint = ?`,
        [`/exercises/${serverId}`, `/exercises/${localId}`],
      );
      db.runSync(
        `UPDATE sync_queue SET entity_id = ?
         WHERE entity_type = 'exercise' AND entity_id = ?`,
        [serverId, localId],
      );
    });
  }

  swapLocalNutritionEntryId(localId: string, serverId: string): void {
    if (localId === serverId) return;
    const db = this.getDb();
    db.withTransactionSync(() => {
      // An entry's id lives inside the day-aggregate blob (no per-entry row),
      // so re-key it in every cached day that references it.
      const rows = db.getAllSync(
        `SELECT user_id, date, payload FROM cached_fuel_today`,
      ) as { user_id: string; date: string; payload: string }[];
      for (const r of rows) {
        const fuel = JSON.parse(r.payload) as FuelToday;
        let touched = false;
        for (const list of Object.values(fuel.entriesBySlot)) {
          for (const e of list) {
            if (e.id === localId) {
              e.id = serverId;
              touched = true;
            }
          }
        }
        if (touched) {
          db.runSync(
            `UPDATE cached_fuel_today SET payload = ? WHERE user_id = ? AND date = ?`,
            [JSON.stringify(fuel), r.user_id, r.date],
          );
        }
      }
      // Re-point any queued entry mutations still addressed to the local id
      // (e.g. a DELETE/PUT enqueued before the create flushed) so they hit the
      // real resource instead of 404ing on `/nutrition/entries/local-…`.
      db.runSync(
        `UPDATE sync_queue SET endpoint = ?
         WHERE entity_type = 'nutrition_entry' AND endpoint = ?`,
        [`/nutrition/entries/${serverId}`, `/nutrition/entries/${localId}`],
      );
      db.runSync(
        `UPDATE sync_queue SET entity_id = ?
         WHERE entity_type = 'nutrition_entry' AND entity_id = ?`,
        [serverId, localId],
      );
    });
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

  getCachedWorkoutHistory(
    userId: string,
    workoutId: string,
  ): CachedWorkoutHistory | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT user_id, workout_id, payload, synced_at FROM cached_workout_history
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
      history: JSON.parse(row.payload) as WorkoutHistory,
      syncedAt: row.synced_at,
    };
  }

  cacheWorkoutHistory(
    userId: string,
    workoutId: string,
    history: WorkoutHistory,
  ): void {
    const db = this.getDb();
    const syncedAt = new Date().toISOString();
    db.runSync(
      `INSERT INTO cached_workout_history (user_id, workout_id, payload, synced_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, workout_id) DO UPDATE SET
         payload = excluded.payload,
         synced_at = excluded.synced_at`,
      [userId, workoutId, JSON.stringify(history), syncedAt],
    );
  }

  removeCachedWorkout(userId: string, workoutId: string): void {
    const db = this.getDb();
    db.withTransactionSync(() => {
      db.runSync(
        `DELETE FROM cached_workout_detail WHERE user_id = ? AND workout_id = ?`,
        [userId, workoutId],
      );
      db.runSync(
        `DELETE FROM cached_workout_history WHERE user_id = ? AND workout_id = ?`,
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

  // -- Coach You Cache (10-trainer-features) --

  getCachedCoachOverview(userId: string): CoachOverview | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT payload FROM cached_coach_overview WHERE user_id = ?`,
      [userId],
    ) as { payload: string }[];
    const row = rows[0];
    if (!row) return null;
    return JSON.parse(row.payload) as CoachOverview;
  }

  cacheCoachOverview(userId: string, payload: CoachOverview): void {
    const db = this.getDb();
    const syncedAt = new Date().toISOString();
    db.runSync(
      `INSERT INTO cached_coach_overview (user_id, payload, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at`,
      [userId, JSON.stringify(payload), syncedAt],
    );
  }

  getCoachOverviewAge(userId: string): string | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT synced_at FROM cached_coach_overview WHERE user_id = ?`,
      [userId],
    ) as { synced_at: string }[];
    return rows[0]?.synced_at ?? null;
  }

  // -- Client Detail Cache (M8 Coach Phase 5) --

  getCachedClientDetail(userId: string, clientId: string): ClientDetail | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT payload FROM cached_client_detail WHERE user_id = ? AND client_id = ?`,
      [userId, clientId],
    ) as { payload: string }[];
    const row = rows[0];
    if (!row) return null;
    return JSON.parse(row.payload) as ClientDetail;
  }

  cacheClientDetail(
    userId: string,
    clientId: string,
    payload: ClientDetail,
  ): void {
    const db = this.getDb();
    const syncedAt = new Date().toISOString();
    db.runSync(
      `INSERT INTO cached_client_detail (user_id, client_id, payload, synced_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, client_id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at`,
      [userId, clientId, JSON.stringify(payload), syncedAt],
    );
  }

  getClientDetailAge(userId: string, clientId: string): string | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT synced_at FROM cached_client_detail WHERE user_id = ? AND client_id = ?`,
      [userId, clientId],
    ) as { synced_at: string }[];
    return rows[0]?.synced_at ?? null;
  }

  // -- Clients Roster Cache (10-trainer-features) --

  getCachedTrainerClients(userId: string): TrainerClient[] | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT payload FROM cached_trainer_clients WHERE user_id = ?`,
      [userId],
    ) as { payload: string }[];
    const row = rows[0];
    if (!row) return null;
    return JSON.parse(row.payload) as TrainerClient[];
  }

  cacheTrainerClients(userId: string, payload: TrainerClient[]): void {
    const db = this.getDb();
    const syncedAt = new Date().toISOString();
    db.runSync(
      `INSERT INTO cached_trainer_clients (user_id, payload, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at`,
      [userId, JSON.stringify(payload), syncedAt],
    );
  }

  getTrainerClientsAge(userId: string): string | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT synced_at FROM cached_trainer_clients WHERE user_id = ?`,
      [userId],
    ) as { synced_at: string }[];
    return rows[0]?.synced_at ?? null;
  }

  // -- Programmes List Cache (19-programs, Phase 9 mobile — coach F1) --

  getCachedPrograms(userId: string): ProgramSummary[] | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT payload FROM cached_programs WHERE user_id = ?`,
      [userId],
    ) as { payload: string }[];
    const row = rows[0];
    if (!row) return null;
    return JSON.parse(row.payload) as ProgramSummary[];
  }

  cachePrograms(userId: string, payload: ProgramSummary[]): void {
    const db = this.getDb();
    const syncedAt = new Date().toISOString();
    db.runSync(
      `INSERT INTO cached_programs (user_id, payload, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at`,
      [userId, JSON.stringify(payload), syncedAt],
    );
  }

  getProgramsAge(userId: string): string | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT synced_at FROM cached_programs WHERE user_id = ?`,
      [userId],
    ) as { synced_at: string }[];
    return rows[0]?.synced_at ?? null;
  }

  // -- Notifications Cache (09) --

  getCachedNotifications(limit = 100): Notification[] {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT id, type, title, body, deep_link, data_json,
              related_entity_type, related_entity_id, read_at, created_at
       FROM cached_notifications
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [limit],
    ) as CachedNotificationRow[];
    return rows.map(rowToNotification);
  }

  cacheNotifications(notifications: Notification[]): void {
    const db = this.getDb();
    // Upsert each row (server-truth wins on conflict), then prune to the
    // newest 100 by created_at — the design.md § SQLite cache LRU bound.
    db.withTransactionSync(() => {
      for (const n of notifications) {
        db.runSync(
          `INSERT INTO cached_notifications
             (id, type, title, body, deep_link, data_json,
              related_entity_type, related_entity_id, read_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             type = excluded.type,
             title = excluded.title,
             body = excluded.body,
             deep_link = excluded.deep_link,
             data_json = excluded.data_json,
             related_entity_type = excluded.related_entity_type,
             related_entity_id = excluded.related_entity_id,
             -- COALESCE so a refresh write-through can't reset an
             -- optimistic read back to unread before the mark-read flushes
             -- (the server returns read_at=null until the queue drains).
             -- Keeps locked-decision-#3's "offline-tap moment lives in the
             -- local cache" invariant — and the bell badge's
             -- getCachedUnreadCount() honest (Inspector Brad).
             read_at = COALESCE(cached_notifications.read_at, excluded.read_at),
             created_at = excluded.created_at`,
          [
            n.id,
            n.type,
            n.title,
            n.body,
            n.deepLink,
            JSON.stringify(n.data ?? {}),
            n.relatedEntityType,
            n.relatedEntityId,
            n.readAt,
            n.createdAt,
          ],
        );
      }
      db.runSync(
        `DELETE FROM cached_notifications
         WHERE id NOT IN (
           SELECT id FROM cached_notifications
           ORDER BY created_at DESC, id DESC
           LIMIT 100
         )`,
      );
    });
  }

  getCachedUnreadCount(): number {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT COUNT(*) AS total FROM cached_notifications WHERE read_at IS NULL`,
    ) as { total: number }[];
    return rows[0]?.total ?? 0;
  }

  /**
   * Optimistically mark a cached row read. Uses COALESCE semantics —
   * only stamps `read_at` when it's currently null — to mirror the
   * server's `COALESCE(read_at, NOW())` so an offline mark + later
   * replay preserves the original read moment (locked decision #3).
   */
  markCachedNotificationRead(id: string, readAt: string): void {
    const db = this.getDb();
    db.runSync(
      `UPDATE cached_notifications
       SET read_at = COALESCE(read_at, ?)
       WHERE id = ?`,
      [readAt, id],
    );
  }

  markAllCachedNotificationsRead(readAt: string): void {
    const db = this.getDb();
    db.runSync(
      `UPDATE cached_notifications
       SET read_at = COALESCE(read_at, ?)
       WHERE read_at IS NULL`,
      [readAt],
    );
  }

  getCachedNotificationPreferences(): NotificationPreferences | null {
    const db = this.getDb();
    const rows = db.getAllSync(
      `SELECT prefs_json FROM cached_notification_preferences WHERE id = 1`,
    ) as { prefs_json: string }[];
    const row = rows[0];
    if (!row) return null;
    try {
      return normalizePreferences(
        JSON.parse(row.prefs_json) as Record<string, unknown>,
      );
    } catch {
      return null;
    }
  }

  cacheNotificationPreferences(preferences: NotificationPreferences): void {
    const db = this.getDb();
    const syncedAt = new Date().toISOString();
    db.runSync(
      `INSERT INTO cached_notification_preferences (id, prefs_json, synced_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         prefs_json = excluded.prefs_json,
         synced_at = excluded.synced_at`,
      [JSON.stringify(preferences), syncedAt],
    );
  }

  // -- Home / Progress cache (M4 — 06-progress-goals) --
  getCachedHome(userId: string): HomePayload | null {
    return this.readBlob<HomePayload>("cached_home", userId);
  }
  getHomeAge(userId: string): string | null {
    return this.readBlobSyncedAt("cached_home", userId);
  }
  cacheHome(userId: string, payload: HomePayload): void {
    this.writeBlob("cached_home", userId, payload);
  }
  invalidateHome(userId: string): void {
    this.getDb().runSync(`DELETE FROM cached_home WHERE user_id = ?`, [userId]);
  }

  // -- Goals cache (M16 — Athlete Training page) --
  getCachedGoals(userId: string): Goal[] | null {
    return this.readBlob<Goal[]>("cached_goals", userId);
  }
  getGoalsAge(userId: string): string | null {
    return this.readBlobSyncedAt("cached_goals", userId);
  }
  cacheGoals(userId: string, goals: Goal[]): void {
    this.writeBlob("cached_goals", userId, goals);
  }
  invalidateGoals(userId: string): void {
    this.getDb().runSync(`DELETE FROM cached_goals WHERE user_id = ?`, [
      userId,
    ]);
  }

  // -- Coach Workout library cache (Workout Authoring v2, S3) --
  getCachedCoachWorkoutLibrary(userId: string): Workout[] | null {
    return this.readBlob<Workout[]>("cached_coach_workout_library", userId);
  }
  cacheCoachWorkoutLibrary(userId: string, workouts: Workout[]): void {
    this.writeBlob("cached_coach_workout_library", userId, workouts);
  }

  getCachedStreaks(userId: string): Streak[] {
    return this.readBlob<Streak[]>("cached_streaks", userId) ?? [];
  }
  cacheStreaks(userId: string, streaks: Streak[]): void {
    this.writeBlob("cached_streaks", userId, streaks);
  }

  getCachedAchievements(userId: string): Achievement[] {
    return this.readBlob<Achievement[]>("cached_achievements", userId) ?? [];
  }
  cacheAchievements(userId: string, achievements: Achievement[]): void {
    this.writeBlob("cached_achievements", userId, achievements);
  }

  getCachedBodyTrend(userId: string): BodyTrendPoint[] {
    return this.readBlob<BodyTrendPoint[]>("cached_body_trend", userId) ?? [];
  }
  cacheBodyTrend(userId: string, series: BodyTrendPoint[]): void {
    this.writeBlob("cached_body_trend", userId, series);
  }

  getCachedVolumeStats(userId: string): VolumeStats | null {
    return this.readBlob<VolumeStats>("cached_volume_stats", userId);
  }
  cacheVolumeStats(userId: string, stats: VolumeStats): void {
    this.writeBlob("cached_volume_stats", userId, stats);
  }

  getCachedHabitCompletions(
    userId: string,
    opts?: { goalId?: string; since?: string },
  ): HabitCompletion[] {
    const db = this.getDb();
    const clauses = ["user_id = ?"];
    const params: (string | number)[] = [userId];
    if (opts?.goalId) {
      clauses.push("goal_id = ?");
      params.push(opts.goalId);
    }
    if (opts?.since) {
      clauses.push("day >= ?");
      params.push(opts.since);
    }
    const rows = db.getAllSync(
      `SELECT id, user_id, goal_id, day, completed_at, value FROM cached_habit_completions
       WHERE ${clauses.join(" AND ")} ORDER BY day DESC`,
      params,
    ) as {
      id: string;
      user_id: string;
      goal_id: string;
      day: string;
      completed_at: string;
      value: number | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      goalId: r.goal_id,
      completedAt: r.completed_at,
      // The `day` column IS the authoritative user-local day (server's
      // local_completed_date, or the optimistic toggle's `day`). Surface it so
      // consumers bucket by it instead of re-slicing completedAt as UTC.
      localCompletedDate: r.day,
      value: r.value,
    }));
  }
  cacheHabitCompletions(userId: string, rows: HabitCompletion[]): void {
    const db = this.getDb();
    db.runSync(`DELETE FROM cached_habit_completions WHERE user_id = ?`, [
      userId,
    ]);
    for (const r of rows) {
      // Prefer the server's authoritative user-local day; only fall back to a
      // UTC slice when a row predates the field. (Slicing alone drops tz ≥ +12
      // toggles the server clamped to a different UTC day.)
      const day = r.localCompletedDate ?? r.completedAt.slice(0, 10);
      db.runSync(
        `INSERT INTO cached_habit_completions (id, user_id, goal_id, day, completed_at, value)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, goal_id, day) DO UPDATE SET
           id = excluded.id, completed_at = excluded.completed_at, value = excluded.value`,
        [r.id, r.userId, r.goalId, day, r.completedAt, r.value],
      );
    }
  }
  upsertHabitCompletion(row: {
    id: string;
    userId: string;
    goalId: string;
    day: string;
    completedAt: string;
    value: number | null;
  }): void {
    this.getDb().runSync(
      `INSERT INTO cached_habit_completions (id, user_id, goal_id, day, completed_at, value)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, goal_id, day) DO UPDATE SET
         completed_at = excluded.completed_at, value = excluded.value`,
      [row.id, row.userId, row.goalId, row.day, row.completedAt, row.value],
    );
  }
  removeHabitCompletion(userId: string, goalId: string, day: string): void {
    this.getDb().runSync(
      `DELETE FROM cached_habit_completions WHERE user_id = ? AND goal_id = ? AND day = ?`,
      [userId, goalId, day],
    );
  }

  getHabitConfigs(userId: string): HabitConfig[] {
    const rows = this.getDb().getAllSync(
      `SELECT payload FROM cached_habit_configs WHERE user_id = ?`,
      [userId],
    ) as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload) as HabitConfig);
  }
  cacheHabitConfigs(userId: string, configs: HabitConfig[]): void {
    const db = this.getDb();
    db.runSync(`DELETE FROM cached_habit_configs WHERE user_id = ?`, [userId]);
    const now = new Date().toISOString();
    for (const c of configs) {
      db.runSync(
        `INSERT INTO cached_habit_configs (user_id, category, payload, synced_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, category) DO UPDATE SET
           payload = excluded.payload, synced_at = excluded.synced_at`,
        [userId, c.category, JSON.stringify(c), now],
      );
    }
  }
  upsertHabitConfig(userId: string, config: HabitConfig): void {
    this.getDb().runSync(
      `INSERT INTO cached_habit_configs (user_id, category, payload, synced_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, category) DO UPDATE SET
         payload = excluded.payload, synced_at = excluded.synced_at`,
      [
        userId,
        config.category,
        JSON.stringify(config),
        new Date().toISOString(),
      ],
    );
  }
  removeHabitConfig(userId: string, category: string): void {
    this.getDb().runSync(
      `DELETE FROM cached_habit_configs WHERE user_id = ? AND category = ?`,
      [userId, category],
    );
  }

  swapLocalHabitGoalId(localGoalId: string, serverGoalId: string): void {
    if (localGoalId === serverGoalId) return;
    const db = this.getDb();
    db.withTransactionSync(() => {
      // Re-key any cached completion rows written under the local goalId.
      // INSERT-then-DELETE (not `UPDATE goal_id`) so a row a concurrent
      // refresh already pulled under the server goalId for the same day
      // wins cleanly via the (user_id, goal_id, day) unique index, instead
      // of a raw UPDATE throwing a constraint violation.
      const rows = db.getAllSync(
        `SELECT id, user_id, day, completed_at, value FROM cached_habit_completions
         WHERE goal_id = ?`,
        [localGoalId],
      ) as {
        id: string;
        user_id: string;
        day: string;
        completed_at: string;
        value: number | null;
      }[];
      for (const r of rows) {
        db.runSync(
          `INSERT INTO cached_habit_completions (id, user_id, goal_id, day, completed_at, value)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, goal_id, day) DO UPDATE SET
             id = excluded.id, completed_at = excluded.completed_at, value = excluded.value`,
          [r.id, r.user_id, serverGoalId, r.day, r.completed_at, r.value],
        );
      }
      db.runSync(`DELETE FROM cached_habit_completions WHERE goal_id = ?`, [
        localGoalId,
      ]);

      // Re-point any queued /habit-completions mutation still addressed to
      // the local goalId — POST carries it in the JSON payload; DELETE
      // carries it in BOTH the payload and the query-string endpoint. Only
      // pending/failed rows are rewritable (mirrors updateMutationPayload —
      // an in-flight entry may already be mid-flush; completed/blocked ones
      // are done).
      const queued = db.getAllSync(
        `SELECT id, payload, endpoint FROM sync_queue
         WHERE entity_type = 'habit_completion' AND status IN ('pending', 'failed')`,
      ) as { id: number; payload: string; endpoint: string }[];
      for (const q of queued) {
        let payload: { goalId?: string } | null = null;
        try {
          payload = JSON.parse(q.payload) as { goalId?: string };
        } catch {
          continue; // malformed row — leave untouched, never crash the swap
        }
        if (payload?.goalId !== localGoalId) continue;

        const newPayload = { ...payload, goalId: serverGoalId };
        // The DELETE endpoint embeds goalId as a query param — rewrite that
        // too, or the drain would PATCH the local id back onto the URL even
        // after the payload is fixed.
        const newEndpoint = q.endpoint.replace(
          `goalId=${encodeURIComponent(localGoalId)}`,
          `goalId=${encodeURIComponent(serverGoalId)}`,
        );
        db.runSync(
          `UPDATE sync_queue SET payload = ?, endpoint = ? WHERE id = ?`,
          [JSON.stringify(newPayload), newEndpoint, q.id],
        );
      }
      // entity_id is `${goalId}:${day}` — re-key it too so a later toggle on
      // the same (goal, day) de-dupes against this row's identity correctly.
      db.runSync(
        `UPDATE sync_queue SET entity_id = ? || substr(entity_id, instr(entity_id, ':'))
         WHERE entity_type = 'habit_completion' AND status IN ('pending', 'failed')
           AND entity_id LIKE ? || ':%'`,
        [serverGoalId, localGoalId],
      );
    });
  }

  /** Shared JSON-blob slot read (cached_home/streaks/achievements). */
  private readBlob<T>(table: string, userId: string): T | null {
    const rows = this.getDb().getAllSync(
      `SELECT payload FROM ${table} WHERE user_id = ?`,
      [userId],
    ) as { payload: string }[];
    return rows[0] ? (JSON.parse(rows[0].payload) as T) : null;
  }
  private readBlobSyncedAt(table: string, userId: string): string | null {
    const rows = this.getDb().getAllSync(
      `SELECT synced_at FROM ${table} WHERE user_id = ?`,
      [userId],
    ) as { synced_at: string }[];
    return rows[0]?.synced_at ?? null;
  }
  private writeBlob(table: string, userId: string, payload: unknown): void {
    this.getDb().runSync(
      `INSERT INTO ${table} (user_id, payload, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at`,
      [userId, JSON.stringify(payload), new Date().toISOString()],
    );
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
      `SELECT id, user_id, workout_id, name, status, started_at, completed_at, notes,
              client_id, client_name, client_initials
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
      // M18 coach Start-live context (null for a normal athlete session).
      withClient: sessionRow.client_id
        ? {
            id: sessionRow.client_id,
            name: sessionRow.client_name ?? "",
            initials: sessionRow.client_initials ?? "",
          }
        : null,
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
            notes, client_id, client_name, client_initials, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           user_id = excluded.user_id,
           workout_id = excluded.workout_id,
           name = excluded.name,
           status = excluded.status,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at,
           notes = excluded.notes,
           client_id = excluded.client_id,
           client_name = excluded.client_name,
           client_initials = excluded.client_initials,
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
          session.withClient?.id ?? null,
          session.withClient?.name ?? null,
          session.withClient?.initials ?? null,
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

  // -- Nutrition / Fuel cache (M9) --

  getCachedFuelToday(userId: string, date: string): FuelToday | null {
    const rows = this.getDb().getAllSync(
      `SELECT payload FROM cached_fuel_today WHERE user_id = ? AND date = ?`,
      [userId, date],
    ) as { payload: string }[];
    return rows[0] ? (JSON.parse(rows[0].payload) as FuelToday) : null;
  }

  getFuelTodayAge(userId: string, date: string): string | null {
    const rows = this.getDb().getAllSync(
      `SELECT synced_at FROM cached_fuel_today WHERE user_id = ? AND date = ?`,
      [userId, date],
    ) as { synced_at: string }[];
    return rows[0]?.synced_at ?? null;
  }

  cacheFuelToday(userId: string, date: string, payload: FuelToday): void {
    this.getDb().runSync(
      `INSERT INTO cached_fuel_today (user_id, date, payload, synced_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at`,
      [userId, date, JSON.stringify(payload), new Date().toISOString()],
    );
  }

  getCachedFoodByBarcode(barcode: string): Food | null {
    const rows = this.getDb().getAllSync(
      `SELECT payload FROM cached_foods WHERE barcode = ? LIMIT 1`,
      [barcode],
    ) as { payload: string }[];
    return rows[0] ? (JSON.parse(rows[0].payload) as Food) : null;
  }

  getCachedFoodById(id: string): Food | null {
    const rows = this.getDb().getAllSync(
      `SELECT payload FROM cached_foods WHERE id = ?`,
      [id],
    ) as { payload: string }[];
    return rows[0] ? (JSON.parse(rows[0].payload) as Food) : null;
  }

  cacheFoods(foods: Food[]): void {
    if (foods.length === 0) return;
    const db = this.getDb();
    const now = new Date().toISOString();
    db.withTransactionSync(() => {
      for (const food of foods) {
        db.runSync(
          `INSERT INTO cached_foods (id, barcode, payload, synced_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET barcode = excluded.barcode, payload = excluded.payload, synced_at = excluded.synced_at`,
          [food.id, food.barcode, JSON.stringify(food), now],
        );
      }
    });
  }

  getCachedNutritionTarget(userId: string): NutritionTarget | null {
    return this.readBlob<NutritionTarget>("cached_nutrition_target", userId);
  }

  getNutritionTargetAge(userId: string): string | null {
    return this.readBlobSyncedAt("cached_nutrition_target", userId);
  }

  cacheNutritionTarget(userId: string, target: NutritionTarget): void {
    this.writeBlob("cached_nutrition_target", userId, target);
  }

  getCachedRecipes(userId: string): Recipe[] {
    const rows = this.getDb().getAllSync(
      `SELECT payload FROM cached_recipes WHERE user_id = ? ORDER BY rowid DESC`,
      [userId],
    ) as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload) as Recipe);
  }

  getCachedRecipe(userId: string, id: string): Recipe | null {
    const rows = this.getDb().getAllSync(
      `SELECT payload FROM cached_recipes WHERE user_id = ? AND id = ?`,
      [userId, id],
    ) as { payload: string }[];
    return rows[0] ? (JSON.parse(rows[0].payload) as Recipe) : null;
  }

  cacheRecipes(userId: string, recipes: Recipe[]): void {
    const db = this.getDb();
    const now = new Date().toISOString();
    db.withTransactionSync(() => {
      // Server refresh wins: drop the user's slice then re-insert. A detail
      // row fetched later re-upserts the fuller (ingredient-bearing) payload.
      db.runSync(`DELETE FROM cached_recipes WHERE user_id = ?`, [userId]);
      for (const recipe of recipes) {
        db.runSync(
          `INSERT INTO cached_recipes (user_id, id, payload, synced_at) VALUES (?, ?, ?, ?)`,
          [userId, recipe.id, JSON.stringify(recipe), now],
        );
      }
    });
  }

  cacheRecipe(userId: string, recipe: Recipe): void {
    this.getDb().runSync(
      `INSERT INTO cached_recipes (user_id, id, payload, synced_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at`,
      [userId, recipe.id, JSON.stringify(recipe), new Date().toISOString()],
    );
  }

  removeCachedRecipe(userId: string, id: string): void {
    this.getDb().runSync(
      `DELETE FROM cached_recipes WHERE user_id = ? AND id = ?`,
      [userId, id],
    );
  }

  getCachedMeals(userId: string): Meal[] {
    const rows = this.getDb().getAllSync(
      `SELECT payload FROM cached_meals WHERE user_id = ? ORDER BY rowid DESC`,
      [userId],
    ) as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload) as Meal);
  }

  cacheMeals(userId: string, meals: Meal[]): void {
    const db = this.getDb();
    const now = new Date().toISOString();
    db.withTransactionSync(() => {
      db.runSync(`DELETE FROM cached_meals WHERE user_id = ?`, [userId]);
      for (const meal of meals) {
        db.runSync(
          `INSERT INTO cached_meals (user_id, id, payload, synced_at) VALUES (?, ?, ?, ?)`,
          [userId, meal.id, JSON.stringify(meal), now],
        );
      }
    });
  }

  cacheMeal(userId: string, meal: Meal): void {
    this.getDb().runSync(
      `INSERT INTO cached_meals (user_id, id, payload, synced_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET payload = excluded.payload, synced_at = excluded.synced_at`,
      [userId, meal.id, JSON.stringify(meal), new Date().toISOString()],
    );
  }

  removeCachedMeal(userId: string, id: string): void {
    this.getDb().runSync(
      `DELETE FROM cached_meals WHERE user_id = ? AND id = ?`,
      [userId, id],
    );
  }

  clearAll(): void {
    const db = this.getDb();
    db.execSync(`
      DELETE FROM sync_queue;
      DELETE FROM cached_workouts;
      DELETE FROM cached_workout_detail;
      DELETE FROM cached_workout_history;
      DELETE FROM cached_coach_workout_library;
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
      DELETE FROM cached_coach_overview;
      DELETE FROM cached_client_detail;
      DELETE FROM cached_trainer_clients;
      DELETE FROM cached_programs;
      DELETE FROM cached_notifications;
      DELETE FROM cached_notification_preferences;
      DELETE FROM cached_fuel_today;
      DELETE FROM cached_foods;
      DELETE FROM cached_recipes;
      DELETE FROM cached_meals;
      DELETE FROM cached_nutrition_target;
    `);
  }
}

/** Raw `cached_notifications` row as stored (snake_case columns). */
type CachedNotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  deep_link: string | null;
  data_json: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

/** Re-hydrate a cached row into the domain `Notification`. */
function rowToNotification(row: CachedNotificationRow): Notification {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data_json) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    data,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
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
  client_id: string | null;
  client_name: string | null;
  client_initials: string | null;
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
