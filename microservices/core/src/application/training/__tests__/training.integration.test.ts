import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { eq, is, SQL } from "drizzle-orm";
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
  CATALOGUE_NAME_FOR_KEY,
  type TrainingSession,
} from "@persistence/training-metrics";
import {
  SEEDED_WEEK_EXPECTED,
  SEEDED_WEEK_NOW,
  SEEDED_WEEK_RECORD_EXERCISE_IDS,
  SEEDED_WEEK_SESSIONS,
  SEEDED_WEEK_TIMEZONE,
} from "@persistence/training-metrics/fixtures";

/**
 * PER-113 (BE-H1) — design H's tests through the real HTTP handlers on
 * PGlite: the shared phone/server week, window limits, two-user and
 * two-coach isolation, and the History day's calories. Only the JWT is
 * stubbed (bearer token = user id).
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

import Elysia from "elysia";
import { coreErrorHandler } from "../../../shared/errorHandler";
import { trainingRoutes } from "../../trainingRoutes";

const TABLES = [
  schema.profiles,
  schema.ptClientRelationships,
  schema.coachClientSettings,
  schema.clientDataAccessLog,
  schema.muscleGroups,
  schema.exercises,
  schema.workoutSessions,
  schema.sessionExercises,
  schema.exerciseSets,
  schema.personalRecords,
  schema.nutritionEntries,
  schema.nutritionTargets,
  schema.waterLog,
  schema.dailyActivityData,
  schema.bodyMeasurements,
  schema.habitCompletions,
  schema.habitConfigs,
  schema.togetherParticipants,
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
  for (const pk of cfg.primaryKeys)
    columns.push(
      `primary key (${pk.columns.map((c) => `"${c.name}"`).join(",")})`,
    );
  return `create table "${cfg.name}" (${columns.join(",")});`;
}

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const app = new Elysia().use(coreErrorHandler).use(trainingRoutes);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function get(
  path: string,
  actor: string | null,
): Promise<{ status: number; json: Json }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      headers: actor ? { authorization: `Bearer ${actor}` } : {},
    }),
  );
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const ATHLETE_A = randomUUID();
const ATHLETE_B = randomUUID();
const COACH_A = randomUUID();
const COACH_B = randomUUID();
const PLAIN_USER = randomUUID();
const NAMELESS = randomUUID();

const muscleIds = new Map<string, string>();

async function seedProfiles() {
  await db.insert(schema.profiles).values([
    {
      id: ATHLETE_A,
      fullName: "Sam Patel",
      timezone: SEEDED_WEEK_TIMEZONE,
      gender: "female",
    },
    { id: ATHLETE_B, fullName: "Lena Okafor", timezone: "Europe/London" },
    { id: COACH_A, fullName: "Ellie", role: "personal_trainer" },
    { id: COACH_B, fullName: "Marcus", role: "personal_trainer" },
    { id: PLAIN_USER, fullName: "Not a coach", role: "user" },
    { id: NAMELESS, fullName: "  " },
  ]);
  const names = [...new Set(Object.values(CATALOGUE_NAME_FOR_KEY))];
  for (const name of [...names, "Full Body"]) {
    const id = randomUUID();
    muscleIds.set(name, id);
    await db.insert(schema.muscleGroups).values({ id, name });
  }
}

const exerciseSeeded = new Set<string>();
/** Fixture set id → its row id. */
const setRowIds = new Map<string, string>();

/** Writes a fixture session (and its exercises) for `userId`. */
async function seedSession(userId: string, s: TrainingSession) {
  await db.insert(schema.workoutSessions).values({
    id: s.id,
    userId,
    name: s.name,
    status: "completed",
    startedAt: new Date(s.startedAt),
    completedAt: s.completedAt ? new Date(s.completedAt) : null,
    totalDurationSeconds: s.durationSeconds,
  });
  for (const [i, e] of s.exercises.entries()) {
    if (!exerciseSeeded.has(e.exerciseId)) {
      exerciseSeeded.add(e.exerciseId);
      const ids = (keys: readonly string[]) =>
        keys.map((k) => muscleIds.get(CATALOGUE_NAME_FOR_KEY[k]!)!);
      await db.insert(schema.exercises).values({
        id: e.exerciseId,
        name: e.name,
        primaryMuscles: e.primary.length
          ? ids(e.primary)
          : [muscleIds.get("Full Body")!],
        secondaryMuscles: ids(e.secondary),
      });
    }
    const seId = randomUUID();
    await db.insert(schema.sessionExercises).values({
      id: seId,
      sessionId: s.id,
      exerciseId: e.exerciseId,
      sortOrder: i,
      isSubstituted: e.isSubstituted,
    });
    for (const [n, set] of e.sets.entries()) {
      const id = randomUUID();
      setRowIds.set(set.id, id);
      await db.insert(schema.exerciseSets).values({
        id,
        sessionExerciseId: seId,
        setNumber: n + 1,
        reps: set.reps,
        weightKg: set.weightKg == null ? null : String(set.weightKg),
        isCompleted: set.isCompleted,
      });
    }
  }
}

async function relate(trainerId: string, clientId: string, status = "active") {
  await db.insert(schema.ptClientRelationships).values({
    trainerId,
    clientId,
    status,
    activatedAt: new Date("2026-10-01T00:00:00Z"),
  } as typeof schema.ptClientRelationships.$inferInsert);
}

async function record(
  userId: string,
  exerciseId: string,
  achievedAt: string,
  setId: string | null = null,
) {
  await db.insert(schema.personalRecords).values({
    userId,
    exerciseId,
    recordType: "1rm",
    value: "105",
    achievedAt: new Date(achievedAt),
    setId,
  });
}

/** Athlete B: one chest workout on Wednesday of the fixture week. */
const B_SESSION: TrainingSession = {
  id: randomUUID(),
  name: "B only",
  startedAt: "2026-11-18T12:00:00.000Z",
  completedAt: "2026-11-18T12:30:00.000Z",
  durationSeconds: null,
  exercises: [
    {
      exerciseId: SEEDED_WEEK_SESSIONS[0]!.exercises[0]!.exerciseId,
      name: "Bench press",
      isSubstituted: false,
      primary: ["chest"],
      secondary: [],
      sets: [{ id: "b-1", isCompleted: true, reps: 5, weightKg: 200 }],
    },
  ],
};

beforeAll(async () => {
  pg = await PGlite.create();
  for (const table of TABLES) await pg.exec(ddl(table));
  db = drizzle(pg, { schema });
  holder.db = db;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(SEEDED_WEEK_NOW));
  exerciseSeeded.clear();
  setRowIds.clear();
  muscleIds.clear();
  await seedProfiles();
  for (const s of SEEDED_WEEK_SESSIONS) await seedSession(ATHLETE_A, s);
  // The squat record sits on the Lower workout's third set (105 × 5).
  for (const id of SEEDED_WEEK_RECORD_EXERCISE_IDS)
    await record(
      ATHLETE_A,
      id,
      "2026-11-18T08:10:00Z",
      setRowIds.get("squat-3"),
    );
  await seedSession(ATHLETE_B, B_SESSION);
});

afterEach(async () => {
  vi.useRealTimers();
  for (const table of TABLES)
    await pg.exec(`truncate "${getTableConfig(table).name}"`);
});

describe("GET /users/me/muscle-volume — shared phone/server week (test 5)", () => {
  it("matches the fixture the phone is held to", async () => {
    const res = await get("/users/me/muscle-volume?days=7", ATHLETE_A);
    expect(res.status).toBe(200);
    const d = res.json.data;
    expect(d.muscles).toEqual(SEEDED_WEEK_EXPECTED.muscles);
    expect(d.trainNext).toEqual(SEEDED_WEEK_EXPECTED.trainNext);
    expect(d.rest).toEqual(SEEDED_WEEK_EXPECTED.rest);
    expect(d.totals).toEqual(SEEDED_WEEK_EXPECTED.totals);
    expect(
      d.topLifts.map((l: Json) => ({
        exerciseId: l.exerciseId,
        oneRepMaxKg: l.oneRepMaxKg,
        isRecord: l.isRecord,
      })),
    ).toEqual(SEEDED_WEEK_EXPECTED.topLifts);
    expect(d).toMatchObject({
      days: 7,
      from: "2026-11-16",
      to: "2026-11-22",
      timezone: "Europe/London",
      bodyType: "female",
    });
  });

  it("defaults to 7 days and a male figure", async () => {
    const res = await get("/users/me/muscle-volume", ATHLETE_B);
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ days: 7, bodyType: "male" });
  });

  it("leaves out a workout that started before the window", async () => {
    const res = await get("/users/me/muscle-volume?days=4", ATHLETE_A);
    // 19–22 Nov: nothing (the week's workouts were on the 16th and 18th).
    expect(res.json.data.totals.workouts).toBe(0);
    const res5 = await get("/users/me/muscle-volume?days=5", ATHLETE_A);
    expect(res5.json.data.totals.workouts).toBe(2);
  });

  it("buckets days in the owner's time zone", async () => {
    // 23:30 UTC on Sat 21 Nov is already Sunday in Auckland.
    await db
      .update(schema.profiles)
      .set({ timezone: "Pacific/Auckland" })
      .where(eq(schema.profiles.id, ATHLETE_B));
    const res = await get("/users/me/muscle-volume?days=1", ATHLETE_B);
    expect(res.json.data.from).toBe("2026-11-23");
  });
});

describe("odd rows", () => {
  it("copes with an unnamed workout, an exercise with no sets or muscles, and one with no exercises", async () => {
    const bare = randomUUID();
    await db.insert(schema.exercises).values({
      id: bare,
      name: "Mystery",
      primaryMuscles: null,
      secondaryMuscles: null,
    });
    const named = randomUUID();
    await db.insert(schema.workoutSessions).values([
      {
        id: named,
        userId: PLAIN_USER,
        status: "completed",
        startedAt: new Date("2026-11-20T10:00:00Z"),
        completedAt: new Date("2026-11-20T10:20:00Z"),
      },
      {
        userId: PLAIN_USER,
        name: "Empty quick workout",
        status: "completed",
        startedAt: new Date("2026-11-21T10:00:00Z"),
        completedAt: null,
      },
      {
        // Still running: never counted.
        userId: PLAIN_USER,
        name: "In progress",
        status: "in_progress",
        startedAt: new Date("2026-11-22T10:00:00Z"),
      },
    ]);
    await db.insert(schema.sessionExercises).values({
      sessionId: named,
      exerciseId: bare,
      sortOrder: 0,
    });
    const res = await get("/users/me/history?date=2026-11-20", PLAIN_USER);
    expect(res.json.data.workouts).toEqual([
      expect.objectContaining({
        name: "Workout",
        sets: 0,
        durationSeconds: 1200,
      }),
    ]);
    const week = await get("/users/me/muscle-volume", PLAIN_USER);
    expect(week.json.data.totals).toEqual({
      workouts: 2,
      durationSeconds: 1200,
      volumeKg: 0,
      sets: 0,
    });
  });

  it("reads a user with no profile row as Europe/London, with nothing logged", async () => {
    const ghost = randomUUID();
    const res = await get("/users/me/recap", ghost);
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      period: "week",
      timezone: "Europe/London",
      together: { sessions: 0, names: [] },
    });
    expect(res.json.data.totals.workouts).toBe(0);
  });
});

describe("window limits (test 2)", () => {
  it.each([
    "/users/me/muscle-volume?days=0",
    "/users/me/muscle-volume?days=93",
    "/users/me/muscle-volume?days=1.5",
    "/users/me/muscle-volume?days=abc",
    "/users/me/history",
    "/users/me/history?month=2026-11&date=2026-11-18",
    "/users/me/history?month=2026-13",
    "/users/me/history?month=26-11",
    "/users/me/history?date=2026-02-30",
    "/users/me/history?date=18-11-2026",
    "/users/me/recap?period=year",
  ])("%s → 400", async (path) => {
    const res = await get(path, ATHLETE_A);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("invalid_window");
  });

  it("accepts the longest window", async () => {
    expect(
      (await get("/users/me/muscle-volume?days=92", ATHLETE_A)).status,
    ).toBe(200);
  });

  it("rejects an unknown coach window", async () => {
    await relate(COACH_A, ATHLETE_A);
    const res = await get(
      `/trainers/me/clients/${ATHLETE_A}/training-review?window=14d`,
      COACH_A,
    );
    expect(res.status).toBe(400);
  });

  it("needs a signed-in user", async () => {
    expect((await get("/users/me/recap", null)).status).toBe(401);
  });
});

describe("two users (isolation)", () => {
  it("never mixes one athlete's training into another's", async () => {
    const a = await get("/users/me/muscle-volume?days=7", ATHLETE_A);
    const b = await get("/users/me/muscle-volume?days=7", ATHLETE_B);
    expect(a.json.data.totals.workouts).toBe(3);
    expect(b.json.data.totals).toEqual({
      workouts: 1,
      durationSeconds: 1800,
      volumeKg: 1000,
      sets: 1,
    });
    expect(a.json.data.topLifts.map((l: Json) => l.oneRepMaxKg)).not.toContain(
      200 * (1 + 5 / 30),
    );

    const dayB = await get("/users/me/history?date=2026-11-18", ATHLETE_B);
    expect(dayB.json.data.workouts.map((w: Json) => w.name)).toEqual([
      "B only",
    ]);
    const dayA = await get("/users/me/history?date=2026-11-18", ATHLETE_A);
    expect(dayA.json.data.workouts.map((w: Json) => w.name)).toEqual([
      "Lower",
      "Core finisher",
    ]);

    const recapB = await get("/users/me/recap?period=week", ATHLETE_B);
    expect(recapB.json.data.totals.workouts).toBe(1);
    expect(recapB.json.data.records).toEqual([]);
  });
});

describe("GET /users/me/history", () => {
  async function logDay(userId: string) {
    await db.insert(schema.nutritionTargets).values({
      userId,
      dailyKcal: "2000",
      proteinG: "150",
      carbsG: "200",
      fatG: "70",
    });
    await db.insert(schema.nutritionEntries).values([
      {
        userId,
        mealSlot: "lunch",
        servings: "1",
        kcal: "1200",
        proteinG: "50",
        carbsG: "100",
        fatG: "30",
        loggedAt: new Date("2026-11-18T12:00:00Z"),
      },
      {
        userId,
        mealSlot: "dinner",
        servings: "1",
        kcal: "950",
        proteinG: "50",
        carbsG: "100",
        fatG: "30",
        loggedAt: new Date("2026-11-18T19:00:00Z"),
      },
      {
        userId,
        mealSlot: "dinner",
        servings: "1",
        kcal: "2600",
        proteinG: "50",
        carbsG: "100",
        fatG: "30",
        loggedAt: new Date("2026-11-20T19:00:00Z"),
      },
    ] as (typeof schema.nutritionEntries.$inferInsert)[]);
    await db.insert(schema.waterLog).values([
      { userId, cups: 6, loggedDate: "2026-11-18" },
      // A day touched but with nothing in it isn't a logged day.
      { userId, cups: 0, loggedDate: "2026-11-04" },
    ]);
    await db.insert(schema.dailyActivityData).values([
      {
        userId,
        activityDate: "2026-11-18",
        steps: 8000,
        dataSource: "apple_health",
      },
      {
        userId,
        activityDate: "2026-11-18",
        steps: 9500,
        dataSource: "google_fit",
      },
      { userId, activityDate: "2026-11-03", steps: 0 },
      { userId, activityDate: "2026-11-05", steps: 4000 },
    ] as (typeof schema.dailyActivityData.$inferInsert)[]);
    await db.insert(schema.bodyMeasurements).values([
      {
        userId,
        weightKg: "80.10",
        measuredAt: new Date("2026-11-18T07:00:00Z"),
      },
      {
        userId,
        weightKg: "79.80",
        measuredAt: new Date("2026-11-18T21:00:00Z"),
      },
      { userId, chestCm: "100", measuredAt: new Date("2026-11-19T07:00:00Z") },
    ]);
    const sleepGoal = randomUUID();
    const gymGoal = randomUUID();
    await db.insert(schema.habitConfigs).values([
      {
        userId,
        goalId: sleepGoal,
        category: "sleep",
        targetValue: "8",
        unit: "hours",
        period: "daily",
        completionRule: "value_gte",
        effectiveFrom: "2026-11-01",
      },
      {
        userId,
        goalId: gymGoal,
        category: "gym",
        targetValue: "4",
        unit: "sessions",
        period: "weekly",
        completionRule: "count",
        effectiveFrom: "2026-11-01",
      },
    ]);
    await db.insert(schema.habitCompletions).values([
      {
        userId,
        goalId: sleepGoal,
        completedAt: new Date("2026-11-18T07:00:00Z"),
        localCompletedDate: "2026-11-18",
        value: "7.5",
      },
      {
        userId,
        goalId: gymGoal,
        completedAt: new Date("2026-11-18T08:00:00Z"),
        localCompletedDate: "2026-11-18",
      },
      {
        userId,
        goalId: sleepGoal,
        completedAt: new Date("2026-11-10T07:00:00Z"),
        localCompletedDate: "2026-11-10",
      },
    ]);
  }

  it("judges the day's calories against the target, marked as the current one (test 4)", async () => {
    await logDay(ATHLETE_A);
    const res = await get("/users/me/history?date=2026-11-18", ATHLETE_A);
    expect(res.status).toBe(200);
    const d = res.json.data;
    expect(d.calories).toEqual({
      kcal: 2150,
      targetKcal: 2000,
      result: "on",
      targetSource: "current",
    });
    expect(d).toMatchObject({
      steps: 9500,
      weightKg: 79.8,
      waterCups: 6,
      sleepHours: 7.5,
    });
    expect([...d.habits].sort()).toEqual(["gym", "sleep"]);
    expect(d.totals.workouts).toBe(2);
    expect(d.workouts[0]).toMatchObject({
      name: "Lower",
      durationSeconds: 3600,
      volumeKg: 6610,
      sets: 12,
      records: 1,
    });
    expect(d.workouts[0].exercises[0]).toMatchObject({
      name: "Back squat",
      isSubstituted: false,
      sets: expect.arrayContaining([
        expect.objectContaining({ reps: 5, weightKg: 105, isCompleted: true }),
      ]),
    });
    expect(d.muscles.find((m: Json) => m.muscle === "quads").hardSets).toBe(4);

    const over = await get("/users/me/history?date=2026-11-20", ATHLETE_A);
    expect(over.json.data.calories.result).toBe("over");
    expect(over.json.data.workouts).toEqual([]);
  });

  it("says when nothing was logged or there's no target", async () => {
    const res = await get("/users/me/history?date=2026-11-19", ATHLETE_B);
    expect(res.json.data.calories).toEqual({
      kcal: null,
      targetKcal: null,
      result: "notLogged",
      targetSource: "current",
    });
    expect(res.json.data).toMatchObject({
      steps: null,
      weightKg: null,
      waterCups: 0,
      sleepHours: null,
      habits: [],
    });
  });

  it("lists the month's logged days", async () => {
    await logDay(ATHLETE_A);
    const res = await get("/users/me/history?month=2026-11", ATHLETE_A);
    expect(res.status).toBe(200);
    const d = res.json.data;
    expect(d).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
    expect(d.loggedDays).toEqual([
      "2026-11-05",
      "2026-11-10",
      "2026-11-16",
      "2026-11-18",
      "2026-11-20",
    ]);
    expect(d.days.find((x: Json) => x.date === "2026-11-18")).toEqual({
      date: "2026-11-18",
      workouts: 2,
      food: true,
      steps: true,
      weight: true,
      habits: true,
    });
    expect(d.days.find((x: Json) => x.date === "2026-11-16")).toEqual({
      date: "2026-11-16",
      workouts: 1,
      food: false,
      steps: false,
      weight: false,
      habits: false,
    });
    const october = await get("/users/me/history?month=2026-10", ATHLETE_A);
    expect(october.json.data.loggedDays).toEqual([]);
  });
});

describe("GET /users/me/recap", () => {
  it("builds the week like the phone, with records and together", async () => {
    const togetherId = randomUUID();
    const upperA = SEEDED_WEEK_SESSIONS[0]!.id;
    await db.insert(schema.togetherParticipants).values([
      {
        sessionId: togetherId,
        userId: ATHLETE_A,
        historyId: upperA,
        execution: {},
        consentVersion: "v1",
      },
      {
        sessionId: togetherId,
        userId: ATHLETE_B,
        execution: {},
        consentVersion: "v1",
      },
      {
        sessionId: togetherId,
        userId: COACH_B,
        execution: {},
        consentVersion: "v1",
        removedFromRoster: true,
      },
      {
        // No name on the profile: counted, not named.
        sessionId: togetherId,
        userId: NAMELESS,
        execution: {},
        consentVersion: "v1",
      },
    ] as (typeof schema.togetherParticipants.$inferInsert)[]);
    const res = await get("/users/me/recap?period=week", ATHLETE_A);
    expect(res.status).toBe(200);
    const d = res.json.data;
    expect(d).toMatchObject({
      period: "week",
      from: "2026-11-16",
      to: "2026-11-22",
      previousFrom: "2026-11-09",
      previousTo: "2026-11-15",
    });
    expect(d.totals).toEqual(SEEDED_WEEK_EXPECTED.totals);
    expect(d.previous.workouts).toBe(0);
    expect(d.muscles).toEqual(SEEDED_WEEK_EXPECTED.muscles);
    expect(d.lifts[0]).toMatchObject({ name: "Back squat", isRecord: true });
    expect(d.volume[0]).toEqual({
      exerciseId: SEEDED_WEEK_SESSIONS[0]!.exercises[1]!.exerciseId,
      name: "Barbell row",
      volumeKg: 2800,
    });
    expect(d.records).toHaveLength(1);
    expect(d.together).toEqual({ sessions: 1, names: ["Lena Okafor"] });
  });

  it("reaches back three months and compares with the three before", async () => {
    const old = {
      ...B_SESSION,
      id: randomUUID(),
      name: "September",
      startedAt: "2026-09-02T12:00:00.000Z",
      completedAt: "2026-09-02T12:30:00.000Z",
    };
    const older = {
      ...old,
      id: randomUUID(),
      name: "August",
      startedAt: "2026-08-20T12:00:00.000Z",
      completedAt: "2026-08-20T12:30:00.000Z",
    };
    await seedSession(ATHLETE_A, old);
    await seedSession(ATHLETE_A, older);
    await record(
      ATHLETE_A,
      B_SESSION.exercises[0]!.exerciseId,
      "2026-09-02T12:30:00Z",
    );
    const res = await get("/users/me/recap?period=3months", ATHLETE_A);
    const d = res.json.data;
    expect(d).toMatchObject({ from: "2026-09-01", previousFrom: "2026-06-01" });
    expect(d.totals.workouts).toBe(4);
    expect(d.previous.workouts).toBe(1);
    expect(d.records.map((r: Json) => r.exerciseName).sort()).toEqual([
      "Back squat",
      "Bench press",
    ]);
    const month = await get("/users/me/recap?period=month", ATHLETE_A);
    expect(month.json.data).toMatchObject({
      from: "2026-11-01",
      previousFrom: "2026-10-01",
    });
    expect(month.json.data.together).toEqual({ sessions: 0, names: [] });
  });
});

describe("GET /trainers/me/clients/:clientId/training-review (test 3)", () => {
  const review = (coach: string, client: string, q = "") =>
    get(`/trainers/me/clients/${client}/training-review${q}`, coach);

  it("lets a coach read their own client's Worked, Strength and PRs", async () => {
    await relate(COACH_A, ATHLETE_A);
    // An earlier squat, so the 4-week strength line has a change.
    await seedSession(ATHLETE_A, {
      id: randomUUID(),
      name: "Old lower",
      startedAt: "2026-11-02T07:00:00.000Z",
      completedAt: "2026-11-02T08:00:00.000Z",
      durationSeconds: null,
      exercises: [
        {
          ...SEEDED_WEEK_SESSIONS[1]!.exercises[0]!,
          sets: [{ id: "old-1", isCompleted: true, reps: 5, weightKg: 100 }],
        },
      ],
    });
    const res = await review(COACH_A, ATHLETE_A);
    expect(res.status).toBe(200);
    const d = res.json.data;
    expect(d).toMatchObject({
      window: "7d",
      from: "2026-11-16",
      strengthFrom: "2026-10-26",
      bodyType: "female",
    });
    expect(d.totals.workouts).toBe(3);
    const quads = d.worked.find((w: Json) => w.muscle === "quads");
    expect(quads).toMatchObject({ hardSets: 4, volumeKg: 2050, pr: true });
    const arms = d.worked.find((w: Json) => w.muscle === "arms");
    expect(arms).toMatchObject({ hardSets: 3, credit: 7, pr: false });
    // Most hard sets first; untrained groups left out.
    expect(d.worked.map((w: Json) => w.hardSets)).toEqual(
      [...d.worked.map((w: Json) => w.hardSets)].sort(
        (a: number, b: number) => b - a,
      ),
    );
    expect(d.worked.some((w: Json) => w.muscle === "forearms")).toBe(true);
    expect(d.worked.every((w: Json) => w.credit > 0)).toBe(true);

    const quadStrength = d.strength.find((s: Json) => s.muscle === "quads");
    expect(quadStrength).toMatchObject({
      lift: "Back squat",
      record: true,
      // 100×5 → 105×5 estimated 1RM.
      change1RmPct: 5,
    });
    const chest = d.strength.find((s: Json) => s.muscle === "chest");
    expect(chest).toMatchObject({ lift: "Bench press", change1RmPct: null });
    expect(d.prsHit).toHaveLength(1);
    expect(d.prsHit[0]).toMatchObject({
      exerciseName: "Back squat",
      muscles: ["quads"],
    });

    const wide = await review(COACH_A, ATHLETE_A, "?window=28d");
    expect(wide.json.data.totals.workouts).toBe(4);

    const audit = await db.select().from(schema.clientDataAccessLog);
    expect(audit[0]).toMatchObject({
      trainerId: COACH_A,
      clientId: ATHLETE_A,
      dataCategory: "training_review",
    });
  });

  it("two coaches: each reads only their own client, and gets 403 for the other's", async () => {
    await relate(COACH_A, ATHLETE_A);
    await relate(COACH_B, ATHLETE_B);
    const own = await review(COACH_B, ATHLETE_B);
    expect(own.status).toBe(200);
    expect(own.json.data.totals.workouts).toBe(1);

    for (const [coach, client] of [
      [COACH_A, ATHLETE_B],
      [COACH_B, ATHLETE_A],
    ] as const) {
      const res = await review(coach, client);
      expect(res.status).toBe(403);
      expect(res.json.code).toBe("not_your_client");
      expect(res.json.data).toBeUndefined();
    }
  });

  it("two coaches of the same athlete see the same shared training", async () => {
    await relate(COACH_A, ATHLETE_A);
    await relate(COACH_B, ATHLETE_A);
    const a = await review(COACH_A, ATHLETE_A);
    const b = await review(COACH_B, ATHLETE_A);
    expect(a.json.data.worked).toEqual(b.json.data.worked);
    expect(a.json.data.strength).toEqual(b.json.data.strength);
  });

  it("refuses an ended relationship and a non-coach", async () => {
    await relate(COACH_A, ATHLETE_A, "ended");
    expect((await review(COACH_A, ATHLETE_A)).status).toBe(403);
    const res = await review(PLAIN_USER, ATHLETE_A);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("not_a_trainer");
  });
});
