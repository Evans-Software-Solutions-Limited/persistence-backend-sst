import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { is, SQL } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "@persistence/db/schema";
import {
  EXERCISE_REF_FIELDS_120,
  RENAME_BODY_120,
  WORKOUT_EXERCISE_FIELDS_120,
  WORKOUT_FIELDS_120,
  createBody120,
  exercise120,
  type FieldSpec,
} from "./fixtures/workouts120.fixture";

/**
 * PER-111 (BE-G1a) — design G part 1, reps per set, end to end: the real
 * workout handlers and repository on a real Postgres (PGlite) carrying the
 * shipped migration. Only the JWT is stubbed (bearer token = user id) and the
 * entitlement gate is opened (it is covered by its own suites).
 *
 * Covers design G's tests: 10/8/8 round-trips through create, read, update,
 * assignment and Loadout variation copy (Together template copy is in
 * social.integration.test.ts); the old columns hold the derived values; an
 * old-shape update with matching values keeps the rows and a changed range
 * drops them; the 1.2.0 workout read fixture still parses; the migration runs
 * forward twice, down and up, with existing workouts unchanged. Plus two-user
 * isolation.
 */

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@persistence/db/client", () => ({
  getDb: () => holder.db,
  createDb: () => holder.db,
}));
vi.mock("@persistence/db", async (original) => ({
  ...(await original<object>()),
  getDb: () => holder.db,
}));
vi.mock("@persistence/api-utils/auth/supabaseAuth", async (original) => ({
  ...(await original<object>()),
  getAuthUser: async (header?: string) =>
    header?.startsWith("Bearer ") ? { sub: header.slice(7) } : null,
}));
vi.mock("../../entitlement/assertEntitlement", async (original) => ({
  ...(await original<object>()),
  assertEntitlement: async () => ({ allowed: true }),
}));

import Elysia from "elysia";
import { coreErrorHandler } from "../../../shared/errorHandler";
import { workoutsCreateHandler } from "../create/workoutsCreateHandler";
import { workoutsUpdateHandler } from "../update/workoutsUpdateHandler";
import { workoutsGetHandler } from "../get/workoutsGetHandler";
import { workoutsListHandler } from "../list/workoutsListHandler";
import { WorkoutRepository } from "../../repositories/workoutRepository";

const MIGRATION = "20261123230809_workout_exercise_set_targets.sql";
const migrationSql = (dir: "migrations" | "rollbacks") =>
  readFileSync(
    new URL(`../../../../../../supabase/${dir}/${MIGRATION}`, import.meta.url),
    "utf8",
  );
const FORWARD = migrationSql("migrations");
const ROLLBACK = migrationSql("rollbacks");

const TABLES = [
  schema.profiles,
  schema.exercises,
  schema.workouts,
  schema.workoutExercises,
  schema.friendships,
  schema.workoutAssignments,
  schema.userSubscriptions,
  schema.subscriptionTiers,
  schema.savedGyms,
  schema.workoutSessions,
];

const dialect = new PgDialect();

/** A table from the Drizzle mirror: columns, defaults, PKs, no FKs. */
function ddl(table: PgTable): string {
  const cfg = getTableConfig(table);
  const columns = cfg.columns.map((c) => {
    let type = c.getSQLType();
    if (c.enumValues?.length) type = "text";
    let def = "";
    if (c.default !== undefined) {
      def =
        " default " +
        (is(c.default, SQL)
          ? dialect.sqlToQuery(c.default).sql
          : typeof c.default === "string"
            ? `'${c.default.replaceAll("'", "''")}'`
            : Array.isArray(c.default) && type.endsWith("[]")
              ? "'{}'"
              : typeof c.default === "object"
                ? `'${JSON.stringify(c.default)}'`
                : String(c.default));
    }
    return `"${c.name}" ${type}${c.notNull ? " not null" : ""}${c.primary ? " primary key" : ""}${def}`;
  });
  return `create table "${cfg.name}" (${columns.join(",")});`;
}

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const app = new Elysia()
  .use(coreErrorHandler)
  .use(workoutsListHandler)
  .use(workoutsCreateHandler)
  .use(workoutsGetHandler)
  .use(workoutsUpdateHandler);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function call(
  method: string,
  path: string,
  actor: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        authorization: `Bearer ${actor}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const USER_A = randomUUID();
const USER_B = randomUUID();
const BENCH = randomUUID();
const ROW = randomUUID();
const PRESS = randomUUID();

const reps = (...values: number[]) => values.map((r) => ({ reps: r }));

/** Stored per-set rows for a workout, in exercise then set order. */
async function storedTargets(workoutId: string) {
  const res = await pg.query<{
    sort_order: number;
    set_number: number;
    target_reps: number;
  }>(
    `select we.sort_order, st.set_number, st.target_reps
       from workout_exercise_set_targets st
       join workout_exercises we on we.id = st.workout_exercise_id
      where we.workout_id = $1
      order by we.sort_order, st.set_number`,
    [workoutId],
  );
  return res.rows;
}

/** The old columns as a 1.2.0 phone reads them, straight from the table. */
async function oldColumns(workoutId: string) {
  const res = await pg.query(
    `select sort_order, target_sets, target_reps_min, target_reps_max
       from workout_exercises where workout_id = $1 order by sort_order`,
    [workoutId],
  );
  return res.rows;
}

/** A 10/8/8 bench plus a plain 3 × 8–12 row, created by `actor`. */
async function createPerSetWorkout(actor = USER_A) {
  const res = await call("POST", "/workouts", actor, {
    name: "Upper",
    exercises: [
      {
        exerciseId: BENCH,
        sortOrder: 0,
        // Deliberately wrong: the server stores the derived values instead.
        targetSets: 5,
        targetRepsMin: 1,
        targetRepsMax: 2,
        restSeconds: 120,
        setTargets: reps(10, 8, 8),
      },
      {
        exerciseId: ROW,
        sortOrder: 1,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
      },
    ],
  });
  expect(res.status).toBe(201);
  return res.json.data;
}

function expectShape(value: Json, spec: Record<string, FieldSpec>): void {
  for (const [key, { type, nullable }] of Object.entries(spec)) {
    expect(value, `field ${key}`).toHaveProperty(key);
    const v = value[key];
    if (v === null) {
      expect(nullable, `${key} is null`).toBe(true);
      continue;
    }
    const actual = Array.isArray(v) ? "array" : typeof v;
    expect(actual, `type of ${key}`).toBe(type);
  }
}

beforeAll(async () => {
  pg = await PGlite.create();
  for (const table of TABLES) await pg.exec(ddl(table));
  await pg.exec(FORWARD);
  db = drizzle(pg, { schema });
  holder.db = db;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await db.insert(schema.profiles).values([
    { id: USER_A, fullName: "Ana" },
    { id: USER_B, fullName: "Ben" },
  ]);
  await db.insert(schema.exercises).values([
    { id: BENCH, name: "Bench press" },
    { id: ROW, name: "Barbell row" },
    { id: PRESS, name: "Overhead press" },
  ]);
  await db.insert(schema.subscriptionTiers).values({
    tierName: "free",
    displayName: "Free",
    priceMonthly: "0",
    priceYearly: "0",
    workoutLimit: null,
  } as typeof schema.subscriptionTiers.$inferInsert);
});

afterEach(async () => {
  const names = TABLES.map((table) => `"${getTableConfig(table).name}"`);
  await pg.exec(`truncate ${names.join(", ")} cascade`);
});

describe("migration 9, set-targets part", () => {
  it("applies forward twice, rolls back and forward again, leaving existing workouts unchanged", async () => {
    const workout = await createPerSetWorkout();
    await pg.query(
      `delete from workout_exercise_set_targets`, // an "existing" workout
    );
    const before = await oldColumns(workout.id);

    await pg.exec(FORWARD);
    await pg.exec(FORWARD);
    expect(await oldColumns(workout.id)).toEqual(before);
    expect(await storedTargets(workout.id)).toEqual([]);

    await pg.exec(ROLLBACK);
    const gone = await pg.query(
      `select 1 from pg_tables where tablename = 'workout_exercise_set_targets'`,
    );
    expect(gone.rows).toEqual([]);
    expect(await oldColumns(workout.id)).toEqual(before);

    await pg.exec(FORWARD);
    expect(await oldColumns(workout.id)).toEqual(before);
    // Reads of an existing workout are exactly today's: no setTargets key.
    const read = await call("GET", `/workouts/${workout.id}`, USER_A);
    expect(read.status).toBe(200);
    for (const ex of read.json.data.exercises)
      expect(ex).not.toHaveProperty("setTargets");
  });

  it("enforces 1–20 sets, 1–100 reps, one row per set, and cascades with the exercise", async () => {
    const workout = await createPerSetWorkout();
    const [{ id: weId }] = (
      await pg.query<{ id: string }>(
        `select id from workout_exercises where workout_id = $1 and sort_order = 1`,
        [workout.id],
      )
    ).rows;
    const insert = (set: number, r: number) =>
      pg.query(
        `insert into workout_exercise_set_targets (workout_exercise_id, set_number, target_reps) values ($1, $2, $3)`,
        [weId, set, r],
      );
    await expect(insert(0, 8)).rejects.toThrow(/set_number_check/);
    await expect(insert(21, 8)).rejects.toThrow(/set_number_check/);
    await expect(insert(1, 0)).rejects.toThrow(/target_reps_check/);
    await expect(insert(1, 101)).rejects.toThrow(/target_reps_check/);
    await insert(20, 100);
    await expect(insert(20, 5)).rejects.toThrow(/exercise_set_key/);

    await pg.query(`delete from workout_exercises where workout_id = $1`, [
      workout.id,
    ]);
    expect(await storedTargets(workout.id)).toEqual([]);
    const orphans = await pg.query(
      `select 1 from workout_exercise_set_targets`,
    );
    expect(orphans.rows).toEqual([]);
  });
});

describe("reps per set — create and read", () => {
  it("stores 10/8/8 with the derived old columns and returns it on every read", async () => {
    const created = await createPerSetWorkout();
    expect(created.exercises[0]).toMatchObject({
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      setTargets: reps(10, 8, 8),
    });
    // An exercise without per-set targets omits the key (1.2.0's shape).
    expect(created.exercises[1]).not.toHaveProperty("setTargets");
    expect(created.exercises[1]).toMatchObject({
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
    });

    expect(await oldColumns(created.id)).toEqual([
      {
        sort_order: 0,
        target_sets: 3,
        target_reps_min: 8,
        target_reps_max: 10,
      },
      {
        sort_order: 1,
        target_sets: 3,
        target_reps_min: 8,
        target_reps_max: 12,
      },
    ]);
    expect(await storedTargets(created.id)).toEqual([
      { sort_order: 0, set_number: 1, target_reps: 10 },
      { sort_order: 0, set_number: 2, target_reps: 8 },
      { sort_order: 0, set_number: 3, target_reps: 8 },
    ]);

    const detail = await call("GET", `/workouts/${created.id}`, USER_A);
    expect(detail.json.data.exercises[0].setTargets).toEqual(reps(10, 8, 8));

    const list = await call("GET", "/workouts?type=mine", USER_A);
    expect(list.status).toBe(200);
    expect(list.json.data[0].exercises[0].setTargets).toEqual(reps(10, 8, 8));
  });

  it("derives the duration estimate from the per-set count", async () => {
    const created = await createPerSetWorkout();
    const plain = await call("POST", "/workouts", USER_A, {
      name: "Same plan, sets sent as 3",
      exercises: [
        {
          exerciseId: BENCH,
          sortOrder: 0,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
          restSeconds: 120,
        },
        {
          exerciseId: ROW,
          sortOrder: 1,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 12,
        },
      ],
    });
    expect(created.estimatedDurationMinutes).toBe(
      plain.json.data.estimatedDurationMinutes,
    );
  });

  it.each([
    ["21 sets", { setTargets: reps(...Array.from({ length: 21 }, () => 8)) }],
    ["0 reps", { setTargets: reps(10, 0) }],
    ["101 reps", { setTargets: reps(101) }],
    ["an empty list", { setTargets: [] }],
    ["a fractional rep", { setTargets: [{ reps: 8.5 }] }],
  ])("rejects %s", async (_label, extra) => {
    const res = await call("POST", "/workouts", USER_A, {
      name: "Bad",
      exercises: [{ exerciseId: BENCH, sortOrder: 0, ...extra }],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const count = await pg.query(`select 1 from workouts`);
    expect(count.rows).toEqual([]);
  });

  it("accepts a per-set list whose sent range is inverted (the derived range wins)", async () => {
    const res = await call("POST", "/workouts", USER_A, {
      name: "Inverted range sent",
      exercises: [
        {
          exerciseId: BENCH,
          sortOrder: 0,
          targetRepsMin: 12,
          targetRepsMax: 6,
          setTargets: reps(6, 12),
        },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.json.data.exercises[0]).toMatchObject({
      targetSets: 2,
      targetRepsMin: 6,
      targetRepsMax: 12,
    });
  });
});

describe("reps per set — update and the old-bundle preservation rule", () => {
  it("replaces the rows when an update sends new setTargets", async () => {
    const w = await createPerSetWorkout();
    const res = await call("PATCH", `/workouts/${w.id}`, USER_A, {
      exercises: [
        { exerciseId: BENCH, sortOrder: 0, setTargets: reps(12, 10, 8, 6) },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.json.data.exercises[0]).toMatchObject({
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 12,
      setTargets: reps(12, 10, 8, 6),
    });
    expect(await storedTargets(w.id)).toHaveLength(4);
  });

  it("keeps the rows through a 1.2.0 rename (no exercises sent)", async () => {
    const w = await createPerSetWorkout();
    const res = await call(
      "PATCH",
      `/workouts/${w.id}`,
      USER_A,
      RENAME_BODY_120,
    );
    expect(res.status).toBe(200);
    expect(res.json.data.name).toBe("Push day (renamed)");
    expect(res.json.data.exercises[0].setTargets).toEqual(reps(10, 8, 8));
  });

  it("keeps the rows when a 1.2.0 plan edit sends the matching derived values", async () => {
    const w = await createPerSetWorkout();
    // 1.2.0 changed only the row's rest time; bench comes back as 3 × 8–10.
    const res = await call("PATCH", `/workouts/${w.id}`, USER_A, {
      exercises: [
        exercise120(BENCH, 0, 3, 8, 10),
        { ...exercise120(ROW, 1, 3, 8, 12), restSeconds: 60 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.json.data.exercises[0].setTargets).toEqual(reps(10, 8, 8));
    expect(res.json.data.exercises[1]).not.toHaveProperty("setTargets");
    expect(res.json.data.exercises[1].restSeconds).toBe(60);
    expect(await storedTargets(w.id)).toHaveLength(3);
  });

  it.each([
    ["a changed set count", exercise120(BENCH, 0, 4, 8, 10)],
    ["a changed rep range", exercise120(BENCH, 0, 3, 6, 10)],
    ["a different position", exercise120(BENCH, 1, 3, 8, 10)],
    ["a different exercise", exercise120(PRESS, 0, 3, 8, 10)],
  ])(
    "drops the rows (the range applies, as today) on %s",
    async (_label, ex) => {
      const w = await createPerSetWorkout();
      const res = await call("PATCH", `/workouts/${w.id}`, USER_A, {
        exercises: [ex],
      });
      expect(res.status).toBe(200);
      expect(res.json.data.exercises[0]).not.toHaveProperty("setTargets");
      expect(res.json.data.exercises[0]).toMatchObject({
        targetSets: ex.targetSets,
        targetRepsMin: ex.targetRepsMin,
        targetRepsMax: ex.targetRepsMax,
      });
      expect(await storedTargets(w.id)).toEqual([]);
    },
  );

  it("drops the rows when an updated app sends setTargets: null", async () => {
    const w = await createPerSetWorkout();
    const res = await call("PATCH", `/workouts/${w.id}`, USER_A, {
      exercises: [{ ...exercise120(BENCH, 0, 3, 8, 10), setTargets: null }],
    });
    expect(res.status).toBe(200);
    expect(res.json.data.exercises[0]).not.toHaveProperty("setTargets");
    expect(await storedTargets(w.id)).toEqual([]);
  });

  it("keeps each copy's rows when one exercise repeats at the same position", async () => {
    const created = await call("POST", "/workouts", USER_A, {
      name: "Repeat",
      exercises: [
        { exerciseId: BENCH, sortOrder: 0, setTargets: reps(10, 8, 8) },
        { exerciseId: BENCH, sortOrder: 0, setTargets: reps(5, 5) },
      ],
    });
    const id = created.json.data.id;
    const res = await call("PATCH", `/workouts/${id}`, USER_A, {
      exercises: [
        exercise120(BENCH, 0, 3, 8, 10),
        exercise120(BENCH, 0, 2, 5, 5),
      ],
    });
    expect(
      res.json.data.exercises.map((e: Json) => e.setTargets).sort(),
    ).toEqual([reps(10, 8, 8), reps(5, 5)].sort());
  });
});

describe("the 1.2.0 workout contract", () => {
  it("1.2.0's create body still creates a workout, read back in 1.2.0's shape", async () => {
    const res = await call(
      "POST",
      "/workouts",
      USER_A,
      createBody120([BENCH, ROW]),
    );
    expect(res.status).toBe(201);
    expectShape(res.json.data, WORKOUT_FIELDS_120);
    for (const ex of res.json.data.exercises) {
      expectShape(ex, WORKOUT_EXERCISE_FIELDS_120);
      expectShape(ex.exercise, EXERCISE_REF_FIELDS_120);
      expect(ex).not.toHaveProperty("setTargets");
    }
  });

  it("a per-set workout still parses for 1.2.0, which sees the derived sets and range", async () => {
    const w = await createPerSetWorkout();
    for (const read of [
      (await call("GET", `/workouts/${w.id}`, USER_A)).json.data,
      (await call("GET", "/workouts?type=mine", USER_A)).json.data[0],
    ]) {
      expectShape(read, WORKOUT_FIELDS_120);
      for (const ex of read.exercises) {
        expectShape(ex, WORKOUT_EXERCISE_FIELDS_120);
        expectShape(ex.exercise, EXERCISE_REF_FIELDS_120);
      }
      // "3 × 8–10" on a 1.2.0 phone for 10 / 8 / 8.
      expect(read.exercises[0]).toMatchObject({
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 10,
      });
    }
  });
});

describe("assignment reads and two-user isolation", () => {
  it("a client assigned the workout reads its set targets; nobody else can", async () => {
    const w = await createPerSetWorkout(USER_A);

    // B is a stranger: 404 on read, 404 on edit, A's rows untouched.
    expect((await call("GET", `/workouts/${w.id}`, USER_B)).status).toBe(404);
    const edit = await call("PATCH", `/workouts/${w.id}`, USER_B, {
      exercises: [{ exerciseId: BENCH, sortOrder: 0, setTargets: reps(1) }],
    });
    expect(edit.status).toBe(404);
    expect(await storedTargets(w.id)).toHaveLength(3);
    const bMine = await call("GET", "/workouts?type=mine", USER_B);
    expect(bMine.json.data).toEqual([]);

    // Coach A assigns it to B (programme occurrences use the same row).
    await db.insert(schema.workoutAssignments).values({
      trainerId: USER_A,
      clientId: USER_B,
      workoutId: w.id,
      assignedDate: "2026-11-23",
    } as typeof schema.workoutAssignments.$inferInsert);

    const detail = await call("GET", `/workouts/${w.id}`, USER_B);
    expect(detail.status).toBe(200);
    expect(detail.json.data.exercises[0].setTargets).toEqual(reps(10, 8, 8));
    const assigned = await call("GET", "/workouts?type=assigned", USER_B);
    expect(assigned.json.data[0].exercises[0].setTargets).toEqual(
      reps(10, 8, 8),
    );
    // Reading is not editing.
    expect(
      (
        await call("PATCH", `/workouts/${w.id}`, USER_B, {
          exercises: [{ exerciseId: BENCH, sortOrder: 0, setTargets: reps(1) }],
        })
      ).status,
    ).toBe(404);
    expect(await storedTargets(w.id)).toHaveLength(3);
  });
});

describe("Loadout variations copy the parent's set targets", () => {
  const repo = new WorkoutRepository();

  it("feeds the parent's set targets into the preview rows", async () => {
    const w = await createPerSetWorkout();
    const rows = await repo.listAdaptationRows(w.id);
    expect(rows[0].setTargets).toEqual(reps(10, 8, 8));
    expect(rows[1]).not.toHaveProperty("setTargets");
  });

  it("carries them to kept and swapped rows a 1.2.0 phone sends without setTargets", async () => {
    const w = await createPerSetWorkout();
    const variation = await repo.createVariation(USER_A, w.id, {
      name: "Upper · Hotel",
      sourceEquipmentTypeIds: [randomUUID()],
      exercises: [
        // Bench swapped for the press, targets carried unchanged.
        {
          ...exercise120(PRESS, 0, 3, 8, 10),
          substitutedFromExerciseId: BENCH,
        },
        exercise120(ROW, 1, 3, 8, 12),
      ],
    });
    expect(variation.exercises[0].setTargets).toEqual(reps(10, 8, 8));
    expect(variation.exercises[1]).not.toHaveProperty("setTargets");
    // The parent is untouched.
    expect(await storedTargets(w.id)).toHaveLength(3);
    expect(await storedTargets(variation.id)).toHaveLength(3);
  });

  it("uses setTargets an updated phone echoes, and drops them when the range changed", async () => {
    const w = await createPerSetWorkout();
    const echoed = await repo.createVariation(USER_A, w.id, {
      name: "Echoed",
      sourceEquipmentTypeIds: [randomUUID()],
      exercises: [
        { exerciseId: BENCH, sortOrder: 0, setTargets: reps(10, 8, 8) },
      ],
    });
    expect(echoed.exercises[0].setTargets).toEqual(reps(10, 8, 8));

    const changed = await repo.createVariation(USER_A, w.id, {
      name: "Changed",
      sourceEquipmentTypeIds: [randomUUID()],
      exercises: [exercise120(BENCH, 0, 3, 5, 5)],
    });
    expect(changed.exercises[0]).not.toHaveProperty("setTargets");
  });

  it("carries them when a variation is replaced after a fresh review", async () => {
    const w = await createPerSetWorkout();
    const variation = await repo.createVariation(USER_A, w.id, {
      name: "First",
      sourceEquipmentTypeIds: [randomUUID()],
      exercises: [],
    });
    const summary = await repo.replaceVariation(USER_A, w.id, variation.id, {
      name: "Replaced",
      sourceEquipmentTypeIds: [randomUUID()],
      exercises: [exercise120(BENCH, 0, 3, 8, 10)],
    });
    expect(summary?.id).toBe(variation.id);
    expect(await storedTargets(variation.id)).toEqual([
      { sort_order: 0, set_number: 1, target_reps: 10 },
      { sort_order: 0, set_number: 2, target_reps: 8 },
      { sort_order: 0, set_number: 3, target_reps: 8 },
    ]);
    // Another user can't replace A's variation.
    expect(
      await repo.replaceVariation(USER_B, w.id, variation.id, {
        name: "Hijack",
        sourceEquipmentTypeIds: [randomUUID()],
        exercises: [],
      }),
    ).toBeNull();
    expect(await storedTargets(variation.id)).toHaveLength(3);
  });
});
