/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Exercise visibility SQL-shape guard (specs/24-coach-authoring STORY-003).
 *
 * The main `exerciseRepository.test.ts` suite mocks `getDb` AND stubs the
 * drizzle helpers, so the visibility SQL is never actually assembled — a
 * broken join would ship green (the mocked-`getDb` blind spot, see
 * reference_drizzle_groupby_param_bug). This file deliberately uses the REAL
 * drizzle helpers, mocks only `getDb`, captures the `WHERE` clause the list
 * query builds, and renders it with `PgDialect` to assert the actual SQL.
 *
 * The two assignment subqueries are built with drizzle's connection-free
 * `QueryBuilder`, so they render fully even though `getDb` is mocked.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { ExerciseRepository, SYSTEM_USER_ID } from "../exerciseRepository";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

/**
 * A getDb().select() chain that captures the WHERE argument of the single
 * main list query and resolves the row page to []. The visibility subqueries
 * do NOT go through getDb (QueryBuilder), so getDb().select() is called exactly
 * once here.
 */
function makeCapturingDb() {
  const capture: { where: unknown } = { where: undefined };
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn((w: unknown) => {
    capture.where = w;
    return chain;
  });
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.offset = vi.fn(() => Promise.resolve([]));
  const db = { select: vi.fn(() => chain) };
  return { db, capture };
}

function renderWhere(where: unknown): string {
  return new PgDialect().sqlToQuery(where as any).sql;
}

function renderParams(where: unknown): unknown[] {
  return new PgDialect().sqlToQuery(where as any).params as unknown[];
}

describe("ExerciseRepository visibility SQL shape (assignment-scoped)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authed: grants own + assigned-programme + assigned-workout, NOT blanket coach", async () => {
    const { db, capture } = makeCapturingDb();
    (getDb as any).mockReturnValue(db);

    const repo = new ExerciseRepository();
    await repo.list({ limit: 20, offset: 0 }, "user-1");

    const sql = renderWhere(capture.where);
    const params = renderParams(capture.where);

    // System catalogue branch (sentinel + defensive IS NULL).
    expect(sql).toContain('"created_by"');
    expect(sql).toContain("is null");
    expect(params).toContain(SYSTEM_USER_ID);

    // Own-custom branch + the caller id threaded into both subqueries.
    expect(params).toContain("user-1");

    // Programme-definition branch: exercises.id IN (select exercise_id from
    // workout_exercises join program_workouts join program_assignments ...).
    expect(sql).toContain('"exercises"."id" in (select');
    expect(sql).toContain('"workout_exercises"');
    expect(sql).toContain('"program_workouts"');
    expect(sql).toContain('"program_assignments"');
    expect(sql).toContain("inner join");
    expect(sql).toContain('"exercise_id"');
    expect(sql).toContain('"client_id"');
    // Live-status filter on the programme assignment.
    expect(sql).toContain('"status" in');
    expect(params).toContain("assigned");
    expect(params).toContain("started");

    // Ad-hoc / occurrence branch keys off workout_assignments.
    expect(sql).toContain('"workout_assignments"');

    // The old blanket "any exercise created by any linked PT" branch is GONE:
    // with no created_by filter, pt_client_relationships must not appear at all.
    expect(sql).not.toContain("pt_client_relationships");
  });

  it("unauth: system-only, no assignment or trainer joins", async () => {
    const { db, capture } = makeCapturingDb();
    (getDb as any).mockReturnValue(db);

    const repo = new ExerciseRepository();
    await repo.list({ limit: 20, offset: 0 }, null);

    const sql = renderWhere(capture.where);
    const params = renderParams(capture.where);

    expect(sql).toContain('"created_by"');
    expect(sql).toContain("is null");
    expect(params).toContain(SYSTEM_USER_ID);

    // No caller → no assignment-scoped or trainer subqueries.
    expect(sql).not.toContain("workout_assignments");
    expect(sql).not.toContain("program_assignments");
    expect(sql).not.toContain("workout_exercises");
    expect(sql).not.toContain("pt_client_relationships");
  });
});
