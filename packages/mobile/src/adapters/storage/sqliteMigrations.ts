/**
 * Versioned SQLite migration runner — mechanism only (M13 sync-hardening,
 * Task 4).
 *
 * Spec: specs/milestones/M13-sync-hardening
 *
 * Every schema change to date has landed as a `CREATE TABLE IF NOT EXISTS`
 * plus, when a column needed to be added to an EXISTING table, a bespoke
 * ad-hoc `PRAGMA table_info` + `ALTER TABLE` block inline in
 * `SQLiteStorageAdapter.initialize()` (see the M18 `active_sessions`
 * column backfill and the M10.6 `sync_queue` CHECK-constraint rebuild).
 * That works, but every future column addition has to hand-roll its own
 * "have I already run?" detection — there's no single ledger of "which
 * migrations has this install applied".
 *
 * This module adds that ledger — a `schema_version` table plus an ordered
 * list of migration steps — WITHOUT touching any of the existing ad-hoc
 * migrations. `SQLITE_MIGRATIONS` starts EMPTY on purpose: folding the
 * pre-existing history in retroactively would require writing a migration
 * step whose `run()` is a no-op for every install that already has the
 * CREATE-IF-NOT-EXISTS shape (i.e. every real install today), which is
 * pure risk for zero benefit. The mechanism exists so the NEXT schema
 * change has a clean, testable place to land instead of another bespoke
 * inline block.
 *
 * Baseline semantics: an install with NO `schema_version` row is assumed
 * to already be at the latest shape — either a fresh install (the
 * CREATE-IF-NOT-EXISTS statements in `initialize()` just landed the
 * current schema) or an existing pre-this-milestone install (which is
 * ALSO already at the latest shape, by the same CREATE-IF-NOT-EXISTS +
 * ad-hoc-migration logic that ran above it in `initialize()`). Baselining
 * stamps `version = <highest known migration id>` and runs nothing —
 * only a genuinely NEW migration added after an install's baseline runs
 * its `run()` step.
 */

/**
 * Structural subset of `expo-sqlite`'s `SQLiteDatabase` that the runner
 * needs. Kept narrow (rather than importing `SQLite.SQLiteDatabase`
 * directly) so tests can pass a lightweight fake without a real native
 * module — `SQLiteStorageAdapter` passes its real `db` at the call site,
 * which structurally satisfies this interface.
 */
export interface SqliteMigrationDb {
  execSync(sql: string): void;
  // `any[]` (not `unknown[]`) is required here so the real `SQLiteDatabase`
  // (whose bind params are a closed union, e.g. `SQLiteBindValue[]`, not
  // `unknown[]`) stays structurally assignable to this narrowed interface.
  getFirstSync(sql: string, params: any[]): unknown;
  runSync(sql: string, params: any[]): { changes: number };
  withTransactionSync(fn: () => void): void;
}

export type SqliteMigration = {
  /** Monotonically increasing id. Migrations run in ascending `id` order. */
  id: number;
  /** Applies the migration. Runs inside a transaction — throw to abort/rollback. */
  run: (db: SqliteMigrationDb) => void;
};

/**
 * Ordered migration steps to apply AFTER an install's baseline. Empty
 * today — see the module doc comment for why existing schema history is
 * deliberately NOT backfilled here. Add new steps here, in ascending
 * `id` order, for the next schema change.
 */
export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [];

/**
 * Run pending versioned migrations against `db`.
 *
 * - Ensures a single-row `schema_version` table exists.
 * - No row yet → baseline at the highest known migration id (or 0 when
 *   `migrations` is empty) and run nothing (see module doc comment).
 * - A row already present → run every migration whose `id` is greater
 *   than the stored version, in ascending order, each in its own
 *   transaction, bumping `schema_version.version` to that migration's id
 *   as part of the same transaction (so a crash mid-migration rolls back
 *   the schema change AND the version bump together — never a half-
 *   applied step recorded as done).
 *
 * Idempotent: calling this twice in a row with the same `migrations` list
 * runs each migration at most once (the second call finds `version`
 * already at the latest id and does nothing).
 *
 * Exported standalone (not a method on `SQLiteStorageAdapter`) so it's
 * testable with a lightweight fake `db` — no expo-sqlite native module
 * required.
 */
export function runSqliteMigrations(
  db: SqliteMigrationDb,
  migrations: readonly SqliteMigration[] = SQLITE_MIGRATIONS,
): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    );
  `);

  const sorted = [...migrations].sort((a, b) => a.id - b.id);
  const latestKnownId = sorted.length > 0 ? sorted[sorted.length - 1].id : 0;

  const row = db.getFirstSync(
    `SELECT version FROM schema_version WHERE id = 1`,
    [],
  ) as { version: number } | null;

  if (row === null) {
    // Baseline: no version recorded yet. Assume the install is already at
    // the latest shape (fresh install, or a pre-M13 install whose ad-hoc
    // migrations already ran above this call in `initialize()`) — stamp
    // the ledger and run nothing.
    db.runSync(`INSERT INTO schema_version (id, version) VALUES (1, ?)`, [
      latestKnownId,
    ]);
    return;
  }

  const current = row.version;
  const pending = sorted.filter((m) => m.id > current);

  for (const migration of pending) {
    db.withTransactionSync(() => {
      migration.run(db);
      db.runSync(`UPDATE schema_version SET version = ? WHERE id = 1`, [
        migration.id,
      ]);
    });
  }
}
