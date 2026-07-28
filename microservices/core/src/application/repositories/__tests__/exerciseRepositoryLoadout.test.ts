/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  ADAPTATION_CANDIDATE_CAP,
  ExerciseRepository,
} from "../exerciseRepository";

// The Loadout reads (spec-21 T-1.1 / T-1.3), asserted through RENDERED SQL.
//
// ⚠ Deliberately a separate file from `exerciseRepository.test.ts`, which stubs
// drizzle's `and`/`or`/`inArray` helpers with sentinel objects. Those stubs make
// `PgDialect` rendering impossible, and rendering is the whole point here: unit
// tests mock `getDb`, so a wrong operator or a dropped predicate ships GREEN
// (memory/reference_drizzle_groupby_param_bug). Every assertion below is on SQL
// text that Postgres would actually receive.

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";

const CHEST = "11111111-1111-4111-8111-111111111111";
const DUMBBELL = "22222222-2222-4222-8222-222222222222";

function render(where: unknown): string {
  return new PgDialect().sqlToQuery(where as never).sql;
}

/** `select().from().where().orderBy().limit()` — the candidate-query shape. */
function makeCandidateChain(
  rows: any[],
  capture: { where?: unknown; limit?: number; selection?: unknown } = {},
) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn((w: unknown) => {
    capture.where = w;
    return chain;
  });
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn((n: number) => {
    capture.limit = n;
    return Promise.resolve(rows);
  });
  return chain;
}

/** `select().from().where()` — the flat-read shape. */
function makeFlatChain(rows: any[], capture: { where?: unknown } = {}) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn((w: unknown) => {
    capture.where = w;
    return Promise.resolve(rows);
  });
  return chain;
}

function candidateRow(overrides: any = {}) {
  return {
    id: "ex-1",
    name: "Dumbbell Bench Press",
    category: "strength",
    difficultyLevel: "intermediate",
    movementType: null,
    primaryMuscles: [CHEST],
    secondaryMuscles: [],
    equipmentRequired: [DUMBBELL],
    thumbnailUrl: null,
    ...overrides,
  };
}

describe("equipmentSubsetOf (T-1.1)", () => {
  let capture: { where?: unknown; limit?: number; selection?: unknown };

  beforeEach(() => {
    capture = {};
    (getDb as any).mockReturnValue({
      select: vi.fn((selection: unknown) => {
        capture.selection = selection;
        return makeCandidateChain([candidateRow()], capture);
      }),
    });
  });

  it("renders CONTAINMENT (@>), which an overlap (&&) implementation cannot satisfy", async () => {
    // The single most consequential line in the feature. `&&` means "needs at
    // least one thing I have" and would hand a barbell squat to someone holding
    // one dumbbell; `@>` means "I have everything it needs".
    await new ExerciseRepository().listAdaptationCandidates("user-a", {
      muscleIds: [CHEST],
      equipmentTypeIds: [DUMBBELL],
    });

    const sql = render(capture.where);
    expect(sql).toContain("@>");
    // The containment operand order matters as much as the operator: reversing it
    // asks "does this exercise's kit contain everything I own".
    //
    // ⚠ This assertion USED TO READ `/\(\$\d+\)::uuid\[\]\s*@>/` — it pinned the
    // paren form, which is a Postgres row constructor and fails at execution
    // (`cannot cast type record to uuid[]`). Rendering the SQL was the right
    // instinct, but a render test only catches what its author knows to be
    // invalid, and this one froze the bug in place as the expectation. See
    // `exerciseRepositoryArrayPredicates.test.ts` for the executable-shape guard.
    expect(sql).toMatch(/ARRAY\[\$\d+\]::uuid\[\]\s*@>\s*COALESCE/);
  });

  it("wraps the column in COALESCE so legacy NULL rows are not silently dropped", async () => {
    // `equipment_required` is nullable on rows predating the `.default([])`, and
    // `@>` against NULL yields NULL — which would remove every legacy row from
    // every adaptation with no error anywhere.
    await new ExerciseRepository().listAdaptationCandidates("user-a", {
      muscleIds: [CHEST],
      equipmentTypeIds: [DUMBBELL],
    });

    expect(render(capture.where)).toContain(
      `COALESCE("exercises"."equipment_required", '{}'::uuid[])`,
    );
  });

  it("never compares the equipment column with overlap", async () => {
    // `&&` legitimately appears for the primary-muscle axis, so the assertion is
    // scoped to the equipment column: this query must not degrade into
    // `equipmentAny`'s "needs at least one thing I have" semantics.
    await new ExerciseRepository().listAdaptationCandidates("user-a", {
      muscleIds: [CHEST],
      equipmentTypeIds: [DUMBBELL],
    });

    const sql = render(capture.where);
    expect(sql).not.toContain(`"exercises"."equipment_required" &&`);
    expect(sql).toContain(`"exercises"."primary_muscles" &&`);
  });

  it("leaves equipmentAny rendering overlap, and never containment", async () => {
    // The two axes must coexist: `GET /exercises?equipment_any=` still means
    // "uses any of these". Asserted in both directions so a regression in either
    // is attributable.
    const listCapture: { where?: unknown } = {};
    const chain: any = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn((w: unknown) => {
      listCapture.where = w;
      return chain;
    });
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.offset = vi.fn().mockResolvedValue([]);
    (getDb as any).mockReturnValue({ select: vi.fn(() => chain) });

    await new ExerciseRepository().list({ equipmentAny: [DUMBBELL] }, "user-a");

    const sql = render(listCapture.where);
    expect(sql).toContain(`"exercises"."equipment_required" &&`);
    expect(sql).not.toContain("@>");
  });
});

describe("listAdaptationCandidates (T-1.3)", () => {
  let capture: { where?: unknown; limit?: number; selection?: unknown };

  function setup(rows: any[]) {
    capture = {};
    (getDb as any).mockReturnValue({
      select: vi.fn((selection: unknown) => {
        capture.selection = selection;
        return makeCandidateChain(rows, capture);
      }),
    });
  }

  beforeEach(() => setup([candidateRow()]));

  it("applies the caller's visibility predicate (AC-3.6)", async () => {
    // The eval could NOT cover this — every seeded row is public, so
    // `buildVisibilityCondition` was a no-op across the whole E2 corpus
    // (VERDICT-E2 § Limitations). A Loadout swap must never surface another
    // coach's private exercise.
    await new ExerciseRepository().listAdaptationCandidates("user-a", {
      muscleIds: [CHEST],
      equipmentTypeIds: [DUMBBELL],
    });

    const sql = render(capture.where);
    // The system-catalogue branch, the own-customs branch, and both
    // assignment-grant subqueries.
    expect(sql).toContain(`"exercises"."created_by"`);
    expect(sql).toContain("workout_assignments");
    expect(sql).toContain("program_assignments");
  });

  it("filters on primary-muscle overlap against the union", async () => {
    await new ExerciseRepository().listAdaptationCandidates("user-a", {
      muscleIds: [CHEST],
      equipmentTypeIds: [DUMBBELL],
    });

    expect(render(capture.where)).toContain(`"exercises"."primary_muscles" &&`);
  });

  it("excludes the plan's own exercises", async () => {
    await new ExerciseRepository().listAdaptationCandidates("user-a", {
      muscleIds: [CHEST],
      equipmentTypeIds: [DUMBBELL],
      excludeExerciseIds: ["ex-src", "ex-src"],
    });

    const sql = render(capture.where);
    expect(sql).toContain(`"exercises"."id" <> ALL(`);
  });

  it("caps at 400 and asks for one extra row to detect truncation", async () => {
    await new ExerciseRepository().listAdaptationCandidates("user-a", {
      muscleIds: [CHEST],
      equipmentTypeIds: [DUMBBELL],
    });

    expect(ADAPTATION_CANDIDATE_CAP).toBe(400);
    expect(capture.limit).toBe(ADAPTATION_CANDIDATE_CAP + 1);
  });

  it("reports truncation and returns exactly the cap", async () => {
    setup(
      Array.from({ length: ADAPTATION_CANDIDATE_CAP + 1 }, (_, i) =>
        candidateRow({ id: `ex-${i}` }),
      ),
    );

    const result = await new ExerciseRepository().listAdaptationCandidates(
      "user-a",
      { muscleIds: [CHEST], equipmentTypeIds: [DUMBBELL] },
    );

    expect(result.truncated).toBe(true);
    expect(result.candidates).toHaveLength(ADAPTATION_CANDIDATE_CAP);
  });

  it("does not report truncation at exactly the cap", async () => {
    setup(
      Array.from({ length: ADAPTATION_CANDIDATE_CAP }, (_, i) =>
        candidateRow({ id: `ex-${i}` }),
      ),
    );

    const result = await new ExerciseRepository().listAdaptationCandidates(
      "user-a",
      { muscleIds: [CHEST], equipmentTypeIds: [DUMBBELL] },
    );

    expect(result.truncated).toBe(false);
    expect(result.candidates).toHaveLength(ADAPTATION_CANDIDATE_CAP);
  });

  it("projects the ranking columns explicitly, never select()", async () => {
    // A bare `select()` emits every schema.ts column, which is how
    // `equipment_types.description` 500s the equipment endpoint. Asserting the
    // PROJECTION, not the mock's return value — dropping a column from the
    // select would otherwise stay green (the mocked-getDb blind spot).
    await new ExerciseRepository().listAdaptationCandidates("user-a", {
      muscleIds: [CHEST],
      equipmentTypeIds: [DUMBBELL],
    });

    expect(Object.keys(capture.selection as object).sort()).toEqual([
      "category",
      "difficultyLevel",
      "equipmentRequired",
      "id",
      "movementType",
      "name",
      "primaryMuscles",
      "secondaryMuscles",
      "thumbnailUrl",
    ]);
  });

  it("normalises NULL array columns to empty arrays", async () => {
    setup([
      candidateRow({
        primaryMuscles: null,
        secondaryMuscles: null,
        equipmentRequired: null,
      }),
    ]);

    const { candidates } =
      await new ExerciseRepository().listAdaptationCandidates("user-a", {
        muscleIds: [CHEST],
        equipmentTypeIds: [DUMBBELL],
      });

    expect(candidates[0]).toMatchObject({
      primaryMuscles: [],
      secondaryMuscles: [],
      equipmentRequired: [],
    });
  });

  it("short-circuits with no query when there are no muscles to match", async () => {
    const select = vi.fn();
    (getDb as any).mockReturnValue({ select });

    const result = await new ExerciseRepository().listAdaptationCandidates(
      "user-a",
      { muscleIds: [], equipmentTypeIds: [DUMBBELL] },
    );

    expect(result).toEqual({ candidates: [], truncated: false });
    expect(select).not.toHaveBeenCalled();
  });
});

describe("listRankableExercises (§ 6.4 others)", () => {
  it("drops the containment predicate so incompatible rows are returned", async () => {
    const capture: { where?: unknown } = {};
    (getDb as any).mockReturnValue({
      select: vi.fn(() => makeCandidateChain([candidateRow()], capture)),
    });

    await new ExerciseRepository().listRankableExercises("user-a", {
      muscleIds: [CHEST],
    });

    const sql = render(capture.where);
    expect(sql).not.toContain("@>");
    // …but the visibility predicate is NOT optional, even for a dimmed list.
    expect(sql).toContain("workout_assignments");
  });
});

describe("findEquipmentRequirements (T-1.6)", () => {
  it("projects only id + equipment_required, keyed by id", async () => {
    const capture: { where?: unknown; selection?: unknown } = {};
    (getDb as any).mockReturnValue({
      select: vi.fn((selection: unknown) => {
        capture.selection = selection;
        return makeFlatChain(
          [{ id: "ex-1", equipmentRequired: [DUMBBELL] }],
          capture,
        );
      }),
    });

    const map = await new ExerciseRepository().findEquipmentRequirements([
      "ex-1",
      "ex-1",
    ]);

    expect(Object.keys(capture.selection as object).sort()).toEqual([
      "equipmentRequired",
      "id",
    ]);
    expect(map.get("ex-1")).toEqual([DUMBBELL]);
  });

  it("maps a NULL requirement to an empty array, not undefined", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn(() =>
        makeFlatChain([{ id: "ex-1", equipmentRequired: null }]),
      ),
    });

    const map = await new ExerciseRepository().findEquipmentRequirements([
      "ex-1",
    ]);

    expect(map.get("ex-1")).toEqual([]);
  });

  it("returns an empty map without querying for an empty id list", async () => {
    const select = vi.fn();
    (getDb as any).mockReturnValue({ select });

    expect(
      (await new ExerciseRepository().findEquipmentRequirements([])).size,
    ).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });
});

describe("listPreviouslyLoggedExerciseIds (§ 6.2's +8 signal)", () => {
  it("scopes to the CALLER's own sessions and the candidate ids", async () => {
    // A cross-user leak here would be silent — it only nudges ranking — which is
    // exactly why it is rendered and asserted.
    const capture: { where?: unknown } = {};
    (getDb as any).mockReturnValue({
      selectDistinct: vi.fn(() =>
        makeFlatChain([{ exerciseId: "ex-1" }], capture),
      ),
    });

    const ids = await new ExerciseRepository().listPreviouslyLoggedExerciseIds(
      "user-a",
      ["ex-1", "ex-2"],
    );

    const sql = render(capture.where);
    expect(sql).toContain(`"workout_sessions"."user_id"`);
    expect(sql).toContain(`"session_exercises"."exercise_id"`);
    expect(ids).toEqual(["ex-1"]);
  });

  it("does not query for an empty candidate list", async () => {
    const selectDistinct = vi.fn();
    (getDb as any).mockReturnValue({ selectDistinct });

    expect(
      await new ExerciseRepository().listPreviouslyLoggedExerciseIds(
        "user-a",
        [],
      ),
    ).toEqual([]);
    expect(selectDistinct).not.toHaveBeenCalled();
  });
});

describe("findEquipmentTypeIdsByName (T-1.11)", () => {
  it("projects id only — `description` is not in the live database", async () => {
    const capture: { where?: unknown; selection?: unknown } = {};
    (getDb as any).mockReturnValue({
      select: vi.fn((selection: unknown) => {
        capture.selection = selection;
        return makeFlatChain([{ id: DUMBBELL }], capture);
      }),
    });

    const ids = await new ExerciseRepository().findEquipmentTypeIdsByName([
      "Dumbbells",
    ]);

    expect(Object.keys(capture.selection as object)).toEqual(["id"]);
    expect(render(capture.where)).toContain(`"equipment_types"."name"`);
    expect(ids).toEqual([DUMBBELL]);
  });

  it("does not query for an empty name list", async () => {
    const select = vi.fn();
    (getDb as any).mockReturnValue({ select });

    expect(
      await new ExerciseRepository().findEquipmentTypeIdsByName([]),
    ).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});
