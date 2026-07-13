import {
  runSqliteMigrations,
  type SqliteMigration,
  type SqliteMigrationDb,
} from "@/adapters/storage/sqliteMigrations";

/**
 * Lightweight fake satisfying `SqliteMigrationDb` — no expo-sqlite native
 * module needed. Backs `schema_version` with a single in-memory row and
 * lets tests observe arbitrary side effects via `execSync` call capture.
 */
function makeFakeDb(): SqliteMigrationDb & {
  execCalls: string[];
  versionRow: { version: number } | null;
} {
  const state: { versionRow: { version: number } | null; execCalls: string[] } =
    {
      versionRow: null,
      execCalls: [],
    };

  const db = {
    execSync(sql: string) {
      state.execCalls.push(sql);
    },
    getFirstSync() {
      return state.versionRow;
    },
    runSync(sql: string, params?: unknown[]) {
      if (/INSERT INTO schema_version/.test(sql)) {
        state.versionRow = { version: (params as number[])[0] };
      } else if (/UPDATE schema_version/.test(sql)) {
        state.versionRow = { version: (params as number[])[0] };
      }
      return { changes: 1 };
    },
    withTransactionSync(fn: () => void) {
      fn();
    },
    get execCalls() {
      return state.execCalls;
    },
    get versionRow() {
      return state.versionRow;
    },
  };
  return db;
}

describe("runSqliteMigrations", () => {
  it("creates the schema_version table", () => {
    const db = makeFakeDb();
    runSqliteMigrations(db, []);
    expect(
      db.execCalls.some((sql) =>
        /CREATE TABLE IF NOT EXISTS schema_version/.test(sql),
      ),
    ).toBe(true);
  });

  it("baselines a fresh install at version 0 when there are no migrations", () => {
    const db = makeFakeDb();
    runSqliteMigrations(db, []);
    expect(db.versionRow).toEqual({ version: 0 });
  });

  it("baselines at the highest known migration id and runs NOTHING on first init", () => {
    const db = makeFakeDb();
    const run = jest.fn();
    const migrations: SqliteMigration[] = [
      { id: 1, run },
      { id: 2, run },
    ];
    runSqliteMigrations(db, migrations);
    expect(db.versionRow).toEqual({ version: 2 });
    expect(run).not.toHaveBeenCalled();
  });

  it("a synthetic migration step runs exactly once and is idempotent on re-init without a version bump", () => {
    const db = makeFakeDb();
    // Simulate an install already baselined BEHIND this migration (e.g.
    // it baselined before migration id=2 was added to SQLITE_MIGRATIONS).
    db.runSync(`INSERT INTO schema_version (id, version) VALUES (1, ?)`, [1]);

    const run = jest.fn();
    const migrations: SqliteMigration[] = [
      { id: 1, run: jest.fn() }, // already applied — must NOT re-run
      { id: 2, run }, // newly added — should run exactly once
    ];

    // First init: the synthetic step (id=2) runs exactly once.
    runSqliteMigrations(db, migrations);
    expect(run).toHaveBeenCalledTimes(1);
    expect(migrations[0].run).not.toHaveBeenCalled();
    expect(db.versionRow).toEqual({ version: 2 });

    // Re-init (app relaunch) with the SAME migrations list: version is
    // already at the latest id, so it does NOT run again and the version
    // does NOT bump a second time.
    runSqliteMigrations(db, migrations);
    expect(run).toHaveBeenCalledTimes(1);
    expect(db.versionRow).toEqual({ version: 2 });
  });

  it("runs a genuinely pending migration once when the stored version is behind", () => {
    const db = makeFakeDb();
    // Simulate an install already baselined at version 1 (e.g. a prior
    // `runSqliteMigrations` call with only migration id=1 known).
    db.runSync(`INSERT INTO schema_version (id, version) VALUES (1, ?)`, [1]);

    const run = jest.fn();
    const migrations: SqliteMigration[] = [
      { id: 1, run: jest.fn() }, // already applied — must NOT re-run
      { id: 2, run }, // newly added — should run exactly once
    ];

    runSqliteMigrations(db, migrations);
    expect(run).toHaveBeenCalledTimes(1);
    expect(migrations[0].run).not.toHaveBeenCalled();
    expect(db.versionRow).toEqual({ version: 2 });

    // Re-running is idempotent — no further calls, no version change.
    runSqliteMigrations(db, migrations);
    expect(run).toHaveBeenCalledTimes(1);
    expect(db.versionRow).toEqual({ version: 2 });
  });

  it("runs multiple pending migrations in ascending id order", () => {
    const db = makeFakeDb();
    db.runSync(`INSERT INTO schema_version (id, version) VALUES (1, ?)`, [0]);

    const order: number[] = [];
    const migrations: SqliteMigration[] = [
      { id: 3, run: () => order.push(3) },
      { id: 1, run: () => order.push(1) },
      { id: 2, run: () => order.push(2) },
    ];

    runSqliteMigrations(db, migrations);
    expect(order).toEqual([1, 2, 3]);
    expect(db.versionRow).toEqual({ version: 3 });
  });

  it("runs each pending migration inside its own transaction", () => {
    const db = makeFakeDb();
    db.runSync(`INSERT INTO schema_version (id, version) VALUES (1, ?)`, [0]);
    const txSpy = jest.spyOn(db, "withTransactionSync");

    const migrations: SqliteMigration[] = [
      { id: 1, run: jest.fn() },
      { id: 2, run: jest.fn() },
    ];
    runSqliteMigrations(db, migrations);

    expect(txSpy).toHaveBeenCalledTimes(2);
  });

  it("defaults to SQLITE_MIGRATIONS (empty) when no migrations arg is passed", () => {
    const db = makeFakeDb();
    expect(() => runSqliteMigrations(db)).not.toThrow();
    expect(db.versionRow).toEqual({ version: 0 });
  });
});
