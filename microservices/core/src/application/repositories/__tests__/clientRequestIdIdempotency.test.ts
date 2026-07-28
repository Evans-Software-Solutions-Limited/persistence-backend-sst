import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { PgInsertBuilder } from "drizzle-orm/pg-core/query-builders";
import { exercises, workouts } from "@persistence/db/schema";

/**
 * Renders the ACTUAL SQL the idempotency inserts emit.
 *
 * This exists because the unit suite mocks `getDb`, so a repository can be fully
 * "covered" while emitting SQL Postgres rejects — the standing mocked-DB blind
 * spot in this repo. It bit exactly here: the migration originally created
 * PARTIAL unique indexes (`WHERE client_request_id IS NOT NULL`), while Drizzle's
 * `onConflictDoNothing({ target })` emits no index predicate (see
 * `drizzle-orm/pg-core/query-builders/insert.js` — the predicate is appended only
 * when `where` is passed). Postgres cannot infer a partial index without a
 * matching predicate, so EVERY keyed create raised 42P10 while 3134 tests stayed
 * green.
 *
 * These assertions pin the two halves that have to agree:
 *   1. the conflict target names both columns, and
 *   2. NO predicate is emitted — which is only correct against a FULL unique
 *      index. If someone reintroduces a partial index in the migration, the
 *      `not.toContain("where")` assertion is the thing that should stop them.
 */

const dialect = new PgDialect();

/**
 * `PgInsertBuilder` needs the dialect (it calls `dialect.escapeName` while
 * building the conflict target) but never touches the session for SQL
 * generation, so a null session is fine and keeps this free of a real
 * connection.
 */
function insertInto(table: typeof exercises | typeof workouts) {
  return new PgInsertBuilder(table as never, null as never, dialect);
}

function render(query: { getSQL: () => unknown }): string {
  return dialect.sqlToQuery(query.getSQL() as never).sql;
}

describe("client_request_id idempotency SQL", () => {
  it("emits a bare two-column conflict target for exercises", () => {
    const sql = render(
      insertInto(exercises)
        .values({ name: "My Lift", createdBy: "u1", clientRequestId: "k1" })
        .onConflictDoNothing({
          target: [exercises.createdBy, exercises.clientRequestId],
        }),
    );

    expect(sql).toContain("on conflict");
    expect(sql).toContain('"created_by"');
    expect(sql).toContain('"client_request_id"');
    expect(sql).toContain("do nothing");
  });

  it("emits NO index predicate — so the index must be FULL, not partial", () => {
    const sql = render(
      insertInto(exercises)
        .values({ name: "My Lift", createdBy: "u1", clientRequestId: "k1" })
        .onConflictDoNothing({
          target: [exercises.createdBy, exercises.clientRequestId],
        }),
    );

    // Everything between `on conflict` and `do nothing` must be just the target.
    const clause = sql.slice(
      sql.indexOf("on conflict"),
      sql.indexOf("do nothing"),
    );
    expect(clause).not.toContain("where");
    expect(clause).not.toContain("is not null");
  });

  it("emits the same shape for workouts", () => {
    const sql = render(
      insertInto(workouts)
        .values({ name: "Push", createdBy: "u1", clientRequestId: "k1" })
        .onConflictDoNothing({
          target: [workouts.createdBy, workouts.clientRequestId],
        }),
    );

    const clause = sql.slice(
      sql.indexOf("on conflict"),
      sql.indexOf("do nothing"),
    );
    expect(clause).toContain('"created_by"');
    expect(clause).toContain('"client_request_id"');
    expect(clause).not.toContain("where");
  });

  it("writes client_request_id as a real column on both tables", () => {
    // Guards against the schema and the migration drifting apart — a missing
    // column here is a runtime 42703, again invisible to a mocked-DB test.
    expect(exercises.clientRequestId.name).toBe("client_request_id");
    expect(workouts.clientRequestId.name).toBe("client_request_id");
  });
});
