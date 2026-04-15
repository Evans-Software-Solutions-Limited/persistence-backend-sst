import * as SQLite from "expo-sqlite";
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

      CREATE TABLE IF NOT EXISTS cached_workouts (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        synced_at TEXT NOT NULL DEFAULT (datetime('now'))
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

      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
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

  clearAll(): void {
    const db = this.getDb();
    db.execSync(`
      DELETE FROM sync_queue;
      DELETE FROM cached_workouts;
      DELETE FROM cached_exercises;
      DELETE FROM active_session;
      DELETE FROM sync_metadata;
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
