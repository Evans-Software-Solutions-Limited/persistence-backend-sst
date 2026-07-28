import {
  ADDITIVE_SYNC_QUEUE_COLUMNS,
  indentSyncQueueDdl,
} from "../sqlite.adapter";
import type { SyncQueueEntry } from "@/domain/ports/storage.port";

/**
 * Guards the `sync_queue` additive-column set, which used to be maintained by hand
 * in three places and is now derived from one constant.
 *
 * The failure this protects against: an install can arrive at the table's current
 * shape by three different routes (fresh `CREATE TABLE`, the M10.6 `sync_queue_new`
 * rebuild, or the PRAGMA-guarded `ALTER … ADD COLUMN` loop). Miss a column in ONE
 * of them and every write naming it throws `no such column` — but only on the
 * device population that took that branch. Reads survive, because they are
 * `SELECT *` and `mapRow` defaults each field. `sqlite.adapter.ts` is excluded from
 * `collectCoverageFrom`, and the in-memory double has no schema at all, so no test
 * executes any of the three sites.
 *
 * Deriving all three from `ADDITIVE_SYNC_QUEUE_COLUMNS` removes the divergence
 * structurally — a missed site is now a TypeScript error, not a runtime one on a
 * subset of devices. What remains testable, and is tested here, is that the
 * constant itself stays sound: every column SQLite-legal in an `ADD COLUMN`, and
 * every one carried through to the `SyncQueueEntry` the drain reads.
 */

describe("sync_queue additive columns", () => {
  it("gives every NOT NULL column a default, so ADD COLUMN is legal", () => {
    // SQLite rejects `ALTER TABLE … ADD COLUMN x NOT NULL` with no default — it
    // cannot invent a value for the existing rows. That throw happens inside
    // `initialize()`, i.e. at app start, for exactly the population being migrated.
    for (const [column, type] of ADDITIVE_SYNC_QUEUE_COLUMNS) {
      if (!type.includes("NOT NULL")) continue;
      expect({ column, hasDefault: /DEFAULT\s+\S+/.test(type) }).toEqual({
        column,
        hasDefault: true,
      });
    }
  });

  it("defaults the counters to 0 — 'never deferred', 'never dispatched'", () => {
    // The value an existing row backfills to has to be the one the drain reads as
    // "this has not happened yet": a non-zero default would make every pre-existing
    // entry look already-dispatched (blocking edit coalescing) or already-deferred
    // (skipping its free run).
    for (const column of ["defer_count", "dispatch_count"]) {
      const entry = ADDITIVE_SYNC_QUEUE_COLUMNS.find(([c]) => c === column);
      expect({ column, found: entry !== undefined }).toEqual({
        column,
        found: true,
      });
      expect(entry![1]).toContain("DEFAULT 0");
    }
  });

  it("renders one indented, comma-terminated DDL line per column", () => {
    // Both CREATE TABLE bodies interpolate this, and both have further columns
    // after it — a missing trailing comma is a syntax error at app start.
    const ddl = indentSyncQueueDdl(8);
    const lines = ddl.split("\n");
    expect(lines).toHaveLength(ADDITIVE_SYNC_QUEUE_COLUMNS.length);
    for (const [i, line] of lines.entries()) {
      expect(line.startsWith("        ")).toBe(true);
      expect(line.endsWith(",")).toBe(true);
      expect(line).toContain(ADDITIVE_SYNC_QUEUE_COLUMNS[i][0]);
      expect(line).toContain(ADDITIVE_SYNC_QUEUE_COLUMNS[i][1]);
    }
  });

  it("indents to the depth asked for, so the rebuild's body stays valid", () => {
    expect(
      indentSyncQueueDdl(12).split("\n")[0].startsWith(" ".repeat(12)),
    ).toBe(true);
  });

  it("surfaces every column on SyncQueueEntry, under its camelCase name", () => {
    // A column present in SQLite but absent from the entry type is a column the
    // drain cannot branch on — the whole reason each of these was added.
    const camel = ADDITIVE_SYNC_QUEUE_COLUMNS.map(([c]) =>
      c.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase()),
    );
    // Compile-time: this object must satisfy the real type, so a rename or removal
    // on the port breaks the build here rather than silently at runtime.
    const probe: Pick<
      SyncQueueEntry,
      | "idempotencyKey"
      | "nextAttemptAt"
      | "deferCount"
      | "dispatchCount"
      | "deferKind"
    > = {
      idempotencyKey: null,
      nextAttemptAt: null,
      deferCount: 0,
      dispatchCount: 0,
      deferKind: null,
    };
    expect(Object.keys(probe).sort()).toEqual([...camel].sort());
  });
});
