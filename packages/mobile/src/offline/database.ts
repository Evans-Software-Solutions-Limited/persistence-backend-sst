import * as SQLite from "expo-sqlite";

const DB_NAME = "persistence.db";

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Get or create the local SQLite database.
 *
 * This is the foundation for offline-first support. All cached data
 * and pending mutations live here so the app works without network.
 */
export function getLocalDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync(DB_NAME);
    db.execSync("PRAGMA journal_mode = WAL;");
    db.execSync("PRAGMA foreign_keys = ON;");
  }
  return db;
}

/**
 * Initialize all local tables. Call once at app startup.
 */
export function initializeLocalDb(): void {
  const localDb = getLocalDb();

  localDb.execSync(`
    -- Sync queue: pending mutations waiting to be sent to the server
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

    -- Cached workouts from the server
    CREATE TABLE IF NOT EXISTS cached_workouts (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Cached exercises from the server
    CREATE TABLE IF NOT EXISTS cached_exercises (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Active session state (local-first, synced when online)
    CREATE TABLE IF NOT EXISTS active_session (
      id TEXT PRIMARY KEY,
      server_id TEXT,
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'local' CHECK(status IN ('local', 'synced', 'pending_sync')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Sync metadata: tracks last successful sync per entity type
    CREATE TABLE IF NOT EXISTS sync_metadata (
      entity_type TEXT PRIMARY KEY,
      last_synced_at TEXT NOT NULL,
      sync_version INTEGER NOT NULL DEFAULT 0
    );

    -- Index for efficient queue processing
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
  `);
}
