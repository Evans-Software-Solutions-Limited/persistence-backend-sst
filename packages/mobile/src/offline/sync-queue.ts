import { getLocalDb } from "./database";

export type SyncOperation = "create" | "update" | "delete";
export type SyncStatus = "pending" | "in_flight" | "failed" | "completed";

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

/**
 * Enqueue a mutation for sync to the SST API.
 *
 * Mutations are stored locally and processed in order when online.
 * This allows the app to accept user input regardless of connectivity.
 */
export function enqueueSync(entry: {
  entityType: string;
  entityId?: string;
  operation: SyncOperation;
  payload: unknown;
  endpoint: string;
  method: string;
}): void {
  const db = getLocalDb();
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

/**
 * Get all pending sync entries in creation order.
 */
export function getPendingEntries(): SyncQueueEntry[] {
  const db = getLocalDb();
  const rows = db.getAllSync(
    `SELECT * FROM sync_queue WHERE status IN ('pending', 'failed')
     AND retry_count < max_retries
     ORDER BY created_at ASC`,
  ) as Record<string, unknown>[];

  return rows.map(mapRow);
}

/**
 * Mark an entry as in-flight (being sent).
 */
export function markInFlight(id: number): void {
  const db = getLocalDb();
  db.runSync(
    `UPDATE sync_queue SET status = 'in_flight', updated_at = datetime('now') WHERE id = ?`,
    [id],
  );
}

/**
 * Mark an entry as completed (successfully synced).
 */
export function markCompleted(id: number): void {
  const db = getLocalDb();
  db.runSync(
    `UPDATE sync_queue SET status = 'completed', updated_at = datetime('now') WHERE id = ?`,
    [id],
  );
}

/**
 * Mark an entry as failed with an error message.
 */
export function markFailed(id: number, errorMessage: string): void {
  const db = getLocalDb();
  db.runSync(
    `UPDATE sync_queue SET status = 'failed', error_message = ?, retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?`,
    [errorMessage, id],
  );
}

/**
 * Get counts of entries by status for UI indicators.
 */
export function getSyncStats(): {
  pending: number;
  failed: number;
  inFlight: number;
} {
  const db = getLocalDb();
  const rows = db.getAllSync(
    `SELECT status, COUNT(*) as count FROM sync_queue
     WHERE status != 'completed'
     GROUP BY status`,
  ) as { status: string; count: number }[];

  const stats = { pending: 0, failed: 0, inFlight: 0 };
  for (const row of rows) {
    if (row.status === "pending") stats.pending = row.count;
    else if (row.status === "failed") stats.failed = row.count;
    else if (row.status === "in_flight") stats.inFlight = row.count;
  }
  return stats;
}

/**
 * Remove completed entries older than the given number of hours.
 */
export function pruneCompleted(olderThanHours = 24): void {
  const db = getLocalDb();
  db.runSync(
    `DELETE FROM sync_queue WHERE status = 'completed'
     AND updated_at < datetime('now', ?)`,
    [`-${olderThanHours} hours`],
  );
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
