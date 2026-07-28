/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import { PgInsertBuilder } from "drizzle-orm/pg-core/query-builders";
import { exercises, workouts } from "@persistence/db/schema";

/**
 * Guards the ONE agreement the idempotent-create mechanism rests on: the SQL the
 * repositories emit must match the index shape the migration creates.
 *
 * It exists because that agreement broke silently. The migration originally
 * created PARTIAL unique indexes (`WHERE client_request_id IS NOT NULL`), while
 * Drizzle's `onConflictDoNothing({ target })` emits no index predicate (see
 * `drizzle-orm/pg-core/query-builders/insert.js` — `where` is appended only when
 * passed explicitly). Postgres cannot infer a partial index without a matching
 * predicate, so EVERY keyed create would have raised 42P10 while 3138 tests
 * stayed green — the standing mocked-`getDb` blind spot in this repo.
 *
 * ⚠ An earlier version of this file tested NEITHER side of that agreement: it
 * built its own `PgInsertBuilder` chain and never imported a repository or read
 * the migration, so it merely restated Drizzle's behaviour back to itself, and
 * passed both with `where` added to the real repository call and with the partial
 * index restored. Both halves are now asserted against the real artifacts:
 *
 *   1. the SQL the REPOSITORIES emit — captured off a real Drizzle insert whose
 *      session records the rendered query, driven through the actual
 *      `create()` / `createWithExercises()` code path;
 *   2. the shape the MIGRATION creates — parsed out of the `.sql` file itself.
 *
 * Either half drifting alone re-breaks production, so neither may be asserted
 * alone.
 */

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { ExerciseRepository } from "../exerciseRepository";
import { WorkoutRepository } from "../workoutRepository";

const MIGRATION_PATH = fileURLToPath(
  new URL(
    "../../../../../../supabase/migrations/20260727120100_client_request_id_idempotency.sql",
    import.meta.url,
  ),
);

/**
 * A `getDb()` stand-in whose `insert()` is a REAL Drizzle insert builder wired to
 * a session that records the rendered SQL instead of sending it. This is what
 * makes the assertions below about the repository rather than about a chain the
 * test wrote itself: the statement captured here is the exact one `postgres.js`
 * would have received.
 *
 * `select()` and `transaction()` are stubs — only the insert path is under test.
 */
function capturingDb(captured: string[], insertReturns: unknown[]) {
  const dialect = new PgDialect();
  const session = {
    prepareQuery(query: { sql: string }) {
      captured.push(query.sql);
      return { execute: async () => insertReturns };
    },
  };
  const db: any = {
    insert: (table: any) =>
      new PgInsertBuilder(table as never, session as never, dialect),
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
    transaction: (cb: (tx: unknown) => unknown) => cb(db),
  };
  return db;
}

/** Everything between `on conflict` and `do nothing` — i.e. the target spec. */
function conflictClause(sql: string): string {
  const start = sql.indexOf("on conflict");
  const end = sql.indexOf("do nothing");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/**
 * The token Drizzle put in the VALUES list for `column`.
 *
 * Needed because Drizzle names EVERY column of the table in an insert and fills
 * the unset ones with the literal `default` — so the mere presence of
 * `"client_request_id"` in the statement proves nothing about whether the key was
 * actually bound. `"$1"`-style means a real bound value; `"default"` means the
 * column was left to the database (NULL here).
 */
function insertedValueFor(sql: string, column: string): string {
  const match = /insert into "\w+" \(([^)]*)\) values \(([^)]*)\)/.exec(sql);
  expect(match, `could not parse insert: ${sql}`).not.toBeNull();
  const columns = match![1].split(",").map((c) => c.trim().replace(/"/g, ""));
  const values = match![2].split(",").map((v) => v.trim());
  const index = columns.indexOf(column);
  expect(index, `${column} not in insert column list`).toBeGreaterThan(-1);
  return values[index];
}

/** Statements, comment lines stripped so prose about `WHERE` can't match. */
function migrationStatements(): string[] {
  const raw = readFileSync(MIGRATION_PATH, "utf8");
  const code = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return code
    .split(";")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

describe("client_request_id idempotency — repository SQL", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ExerciseRepository.create emits a bare two-column conflict target", async () => {
    const captured: string[] = [];
    (getDb as any).mockReturnValue(capturingDb(captured, [{ id: "e1" }]));

    await new ExerciseRepository().create(
      "u1",
      { name: "My Lift" } as any,
      "key-1",
    );

    expect(captured).toHaveLength(1);
    const clause = conflictClause(captured[0]);
    expect(clause).toContain('"created_by"');
    expect(clause).toContain('"client_request_id"');
    // A predicate here is only inferable against a PARTIAL index. The migration
    // creates full ones, so its presence means 42P10 on every keyed create.
    expect(clause).not.toContain("where");
    expect(clause).not.toContain("is not null");
  });

  it("WorkoutRepository.createWithExercises emits the same shape", async () => {
    const captured: string[] = [];
    (getDb as any).mockReturnValue(capturingDb(captured, [{ id: "w1" }]));

    const repo = new WorkoutRepository();
    vi.spyOn(repo as any, "fetchWorkoutWithExercises").mockResolvedValue({
      id: "w1",
    });

    await repo.createWithExercises(
      "u1",
      { name: "Push", exercises: [] } as any,
      "key-1",
    );

    expect(captured).toHaveLength(1);
    const clause = conflictClause(captured[0]);
    expect(clause).toContain('"created_by"');
    expect(clause).toContain('"client_request_id"');
    expect(clause).not.toContain("where");
    expect(clause).not.toContain("is not null");
  });

  it("actually BINDS the key, rather than leaving the column defaulted", async () => {
    const captured: string[] = [];
    (getDb as any).mockReturnValue(capturingDb(captured, [{ id: "e1" }]));

    await new ExerciseRepository().create(
      "u1",
      { name: "My Lift" } as any,
      "key-1",
    );

    // A key dropped on the way to the INSERT would make the whole mechanism a
    // no-op — the conflict target would never match anything — while still
    // looking idempotent in every mocked test.
    expect(insertedValueFor(captured[0], "client_request_id")).toMatch(
      /^\$\d+$/,
    );
  });

  it("omits ON CONFLICT and leaves the key unbound when none is supplied", async () => {
    const captured: string[] = [];
    (getDb as any).mockReturnValue(capturingDb(captured, [{ id: "e1" }]));

    await new ExerciseRepository().create("u1", { name: "My Lift" } as any);

    expect(captured).toHaveLength(1);
    // Legacy and direct-API callers must keep the exact previous behaviour: a
    // plain insert. An unconditional ON CONFLICT would silently swallow real
    // duplicate-key errors for them.
    expect(captured[0]).not.toContain("on conflict");
    expect(insertedValueFor(captured[0], "client_request_id")).toBe("default");
  });
});

describe("client_request_id idempotency — migration shape", () => {
  it("creates exactly two unique indexes, both FULL", () => {
    const creates = migrationStatements().filter((s) =>
      s.includes("create unique index"),
    );

    expect(creates).toHaveLength(2);
    for (const stmt of creates) {
      // The partial predicate the repositories cannot match. Asserted against
      // the real file because `CREATE UNIQUE INDEX IF NOT EXISTS` is name-checked
      // only — a database carrying the old partial index would skip the CREATE
      // and go on raising 42P10 while the migration reported success.
      expect(stmt).not.toContain("where");
      expect(stmt).toContain("(created_by, client_request_id)");
    }
    const joined = creates.join("\n");
    expect(joined).toContain("workouts_created_by_client_request_idx");
    expect(joined).toContain("exercises_created_by_client_request_idx");
  });

  it("drops each index before creating it, so a re-run converges on shape", () => {
    const statements = migrationStatements();
    for (const name of [
      "workouts_created_by_client_request_idx",
      "exercises_created_by_client_request_idx",
    ]) {
      const dropAt = statements.findIndex(
        (s) => s.includes("drop index") && s.includes(name),
      );
      const createAt = statements.findIndex(
        (s) => s.includes("create unique index") && s.includes(name),
      );
      expect(dropAt, `missing DROP INDEX for ${name}`).toBeGreaterThan(-1);
      expect(statements[dropAt]).toContain("if exists");
      expect(dropAt).toBeLessThan(createAt);
    }
  });

  it("adds the column to both tables additively", () => {
    const statements = migrationStatements();
    for (const table of ["workouts", "exercises"]) {
      const alter = statements.find(
        (s) => s.startsWith(`alter table ${table}`) && s.includes("add column"),
      );
      expect(alter, `missing ALTER for ${table}`).toBeDefined();
      // NOT NULL or a DEFAULT would rewrite the table and break every existing
      // row; nullability is also what makes NULLs distinct under the index.
      expect(alter).toContain("if not exists");
      expect(alter).not.toContain("not null");
    }
  });

  it("keeps the schema column names the indexes and SQL rely on", () => {
    expect(exercises.clientRequestId.name).toBe("client_request_id");
    expect(workouts.clientRequestId.name).toBe("client_request_id");
    expect(exercises.createdBy.name).toBe("created_by");
    expect(workouts.createdBy.name).toBe("created_by");
  });
});
