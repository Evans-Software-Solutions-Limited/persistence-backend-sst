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

/**
 * Loadout (spec-21 § 7.1) — `findUnreadableExerciseIds` is the SECURITY control
 * on `POST /workouts/:id/variations`: every submitted row is re-verified for
 * read-visibility so an adaptation can't be used to smuggle another coach's
 * private exercise into a workout the caller owns.
 *
 * It reuses `buildVisibilityCondition` rather than re-deriving the grant set, so
 * the rendered SQL is asserted here for the same reason the list query is —
 * a predicate that quietly dropped the visibility half would ship green.
 */
describe("ExerciseRepository.findUnreadableExerciseIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** `select().from().where()` — no orderBy/limit on this query. */
  function makeIdLookupDb(rows: { id: string }[]) {
    const capture: { where: unknown } = { where: undefined };
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn((w: unknown) => {
      capture.where = w;
      return Promise.resolve(rows);
    });
    const db = { select: vi.fn(() => chain) };
    return { db, capture };
  }

  it("applies the FULL visibility predicate, not just an id filter", async () => {
    const { db, capture } = makeIdLookupDb([]);
    (getDb as any).mockReturnValue(db);

    await new ExerciseRepository().findUnreadableExerciseIds("user-1", [
      "ex-1",
      "ex-2",
    ]);

    const sql = renderWhere(capture.where);
    const params = renderParams(capture.where);

    // The id filter…
    expect(sql).toContain('"id" in');
    expect(params).toContain("ex-1");
    expect(params).toContain("ex-2");
    // …AND the visibility grant set. Without these branches the function would
    // report every existing exercise as readable, silently disabling the gate.
    expect(params).toContain(SYSTEM_USER_ID);
    expect(params).toContain("user-1");
    expect(sql).toContain('"program_assignments"');
    expect(sql).toContain('"workout_assignments"');
  });

  it("returns the ids the visibility predicate did not return", async () => {
    // Only ex-1 came back from the visibility-filtered query.
    const { db } = makeIdLookupDb([{ id: "ex-1" }]);
    (getDb as any).mockReturnValue(db);

    const result = await new ExerciseRepository().findUnreadableExerciseIds(
      "user-1",
      ["ex-1", "ex-private"],
    );

    expect(result).toEqual(["ex-private"]);
  });

  it("returns [] when every id is readable", async () => {
    const { db } = makeIdLookupDb([{ id: "ex-1" }, { id: "ex-2" }]);
    (getDb as any).mockReturnValue(db);

    expect(
      await new ExerciseRepository().findUnreadableExerciseIds("user-1", [
        "ex-1",
        "ex-2",
      ]),
    ).toEqual([]);
  });

  it("dedupes before querying and reports each unreadable id once", async () => {
    const { db, capture } = makeIdLookupDb([]);
    (getDb as any).mockReturnValue(db);

    const result = await new ExerciseRepository().findUnreadableExerciseIds(
      "user-1",
      ["ex-1", "ex-1", "ex-2"],
    );

    expect(result).toEqual(["ex-1", "ex-2"]);
    // A plan can legitimately repeat an exercise; the lookup shouldn't.
    const params = renderParams(capture.where);
    expect(params.filter((p) => p === "ex-1")).toHaveLength(1);
  });

  it("short-circuits an empty list without querying", async () => {
    const { db } = makeIdLookupDb([]);
    (getDb as any).mockReturnValue(db);

    expect(
      await new ExerciseRepository().findUnreadableExerciseIds("user-1", []),
    ).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });
});
