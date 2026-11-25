import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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

/**
 * PER-114 (BE-B1) — design B D6 tests 2–5, against the REAL migrations
 * (PER-108's migration 1 and this ticket's migration 2) on PGlite, through the
 * real HTTP handlers and the real `AdherenceRepository`. Stubbed edges only:
 * the JWT (bearer token = user id), the coach's push, and the LEGACY roster,
 * overview and detail aggregates (their own suites cover them; here they are
 * pinned to prove the handlers pass every legacy field through unchanged).
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

vi.mock("../../trainers/onBehalfNotifications", () => ({
  emitTrainerOnBehalfNotification: vi.fn(async () => {}),
}));

const legacy = vi.hoisted(() => ({
  roster: new Map<string, Record<string, unknown>[]>(),
  overview: null as unknown as Record<string, unknown>,
  detail: null as unknown as Record<string, unknown>,
  trainers: new Set<string>(),
}));
vi.mock("../../repositories/trainerService", async () => {
  const { default: Elysia } = await import("elysia");
  return {
    TrainerService: new Elysia({ name: "TrainerServiceMock" }).decorate(
      "TrainerRepository",
      {
        isTrainer: async (id: string) => legacy.trainers.has(id),
        getClients: async (id: string) =>
          structuredClone(legacy.roster.get(id) ?? []),
        getOverview: async () => structuredClone(legacy.overview),
      },
    ),
  };
});
vi.mock("../../repositories/clientDetailRepository", () => ({
  ClientDetailRepository: class {
    getClientDetail = async () => structuredClone(legacy.detail);
  },
}));

import Elysia from "elysia";
import { coreErrorHandler } from "../../../shared/errorHandler";
import { trainersClientAdherenceHandler } from "../../trainers/clients/trainersClientAdherenceHandler";
import { trainersClientDetailGetHandler } from "../../trainers/clients/trainersClientDetailGetHandler";
import { trainersClientsListHandler } from "../../trainers/clients/trainersClientsListHandler";
import { trainersOverviewHandler } from "../../trainers/overview/trainersOverviewHandler";
import { nutritionTargetsSetHandler } from "../../nutrition/targets/set/nutritionTargetsSetHandler";
import { trainersMeSetClientNutritionTargetHandler } from "../../trainers/nutrition/trainersMeSetClientNutritionTargetHandler";
import { AdherenceRepository } from "../adherenceRepository";
import {
  adherenceByArea,
  computeAdherence,
  targetResolver,
} from "../computeAdherence";
import contract from "./fixtures/contract-1.2.0-adherence.json";

const MIGRATIONS = "../../../../../../supabase/migrations/";
const ROLLBACKS = "../../../../../../supabase/rollbacks/";
const read = (dir: string, file: string) =>
  readFile(new URL(`${dir}${file}`, import.meta.url), "utf8");
const COACHING_MIGRATION =
  "20261120120000_coaching_relationships_client_profiles.sql";
const MIGRATION = "20261121000100_nutrition_target_history.sql";

const dialect = new PgDialect();

/** Tables the two migrations and these handlers read, from the Drizzle mirror. */
const BASE_TABLES = [
  schema.profiles,
  schema.ptClientRelationships,
  schema.dataSharingConsents,
  schema.trainerClientNotes,
  schema.nutritionTargets,
  schema.notifications,
  schema.trainerActionsAudit,
  schema.workoutPrograms,
  schema.programAssignments,
  schema.workoutAssignments,
  schema.clientAiSummaries,
  schema.workoutSessions,
  schema.nutritionEntries,
  schema.clientDataAccessLog,
];

/** Same shape as the PER-108 suite's helper: columns, defaults, plain uniques. */
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
                : String(c.default as number | boolean | bigint));
    }
    return `"${c.name}" ${type}${c.notNull ? " not null" : ""}${c.primary ? " primary key" : ""}${def}`;
  });
  for (const pk of cfg.primaryKeys)
    columns.push(
      `primary key (${pk.columns.map((c) => `"${c.name}"`).join(",")})`,
    );
  for (const idx of cfg.indexes.filter(
    (i) => i.config.unique && !i.config.where,
  )) {
    const cols = idx.config.columns.map((c) =>
      "name" in c ? `"${c.name}"` : "",
    );
    if (cols.every(Boolean)) columns.push(`unique (${cols.join(",")})`);
  }
  return `create table "${cfg.name}" (${columns.join(",")});`;
}

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

/** A database as it was before migration 2; then (by default) after it. */
async function rebuild(withHistory = true): Promise<void> {
  await pg.exec(
    "drop schema if exists public cascade; drop schema if exists auth cascade; create schema public; create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';",
  );
  for (const table of BASE_TABLES) await pg.exec(ddl(table));
  await pg.exec(
    "alter table pt_client_relationships drop column activated_at, drop column client_profile_id;",
  );
  await pg.exec(
    await read(MIGRATIONS, "20260626110000_trainer_invite_codes.sql"),
  );
  await pg.exec(await read(MIGRATIONS, COACHING_MIGRATION));
  if (withHistory) await pg.exec(await read(MIGRATIONS, MIGRATION));
}

// Friday 20 Nov 2026, 10:00 GMT. Only `Date` is faked (PGlite keeps its timers).
const NOW = new Date("2026-11-20T10:00:00Z");

const COACH_A = randomUUID();
const COACH_B = randomUUID();
const COACH_D = randomUUID();
const ATHLETE_C = randomUUID();
const ATHLETE_E = randomUUID();
const USER_U = randomUUID();
const REL_AC = randomUUID();
const REL_BC = randomUUID();
const REL_AE = randomUUID();

const app = new Elysia()
  .use(coreErrorHandler)
  .use(trainersClientAdherenceHandler)
  .use(trainersClientsListHandler)
  .use(trainersOverviewHandler)
  .use(trainersClientDetailGetHandler)
  .use(nutritionTargetsSetHandler)
  .use(trainersMeSetClientNutritionTargetHandler);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function http(
  method: string,
  path: string,
  actor: string | null,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(actor ? { authorization: `Bearer ${actor}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const TARGET = {
  dailyKcal: 2000,
  proteinG: 150,
  carbsG: 200,
  fatG: 70,
  waterCups: 8,
};

/** Two coaches share athlete C; coach A also has athlete E (New York). */
async function seed(): Promise<void> {
  await pg.query(
    `insert into profiles (id, role, full_name, timezone) values
      ($1, 'personal_trainer', 'Coach A', 'Europe/London'),
      ($2, 'personal_trainer', 'Coach B', 'Europe/London'),
      ($3, 'personal_trainer', 'Coach D', 'Europe/London'),
      ($4, 'user', 'Cal', 'Europe/London'),
      ($5, 'user', 'Eve', 'America/New_York'),
      ($6, 'user', 'Uma', 'Europe/London')`,
    [COACH_A, COACH_B, COACH_D, ATHLETE_C, ATHLETE_E, USER_U],
  );
  await pg.query(
    `insert into pt_client_relationships (id, trainer_id, client_id, status, activated_at) values
      ($1, $4, $6, 'active', '2026-09-01T09:00:00Z'),
      ($2, $5, $6, 'active', '2026-09-01T09:00:00Z'),
      ($3, $4, $7, 'active', '2026-11-17T15:00:00Z')`,
    [REL_AC, REL_BC, REL_AE, COACH_A, COACH_B, ATHLETE_C, ATHLETE_E],
  );
  await pg.query(
    `insert into coach_client_settings (relationship_id, trainer_id, client_id, track_training, track_calories, sessions_per_week) values
      ($1, $4, $6, true, true, 4),
      ($2, $5, $6, true, true, 2),
      ($3, $4, $7, false, true, null)`,
    [REL_AC, REL_BC, REL_AE, COACH_A, COACH_B, ATHLETE_C, ATHLETE_E],
  );

  // C: 3 completed sessions in the window, one in progress, one too old.
  await pg.query(
    `insert into workout_sessions (user_id, status, completed_at) values
      ($1, 'completed', '2026-11-17T18:00:00Z'),
      ($1, 'completed', '2026-11-18T18:00:00Z'),
      ($1, 'completed', '2026-11-20T08:00:00Z'),
      ($1, 'in_progress', null),
      ($1, 'completed', '2026-11-10T18:00:00Z'),
      ($2, 'completed', '2026-11-19T18:00:00Z')`,
    [ATHLETE_C, ATHLETE_E],
  );

  // C's target: 2000 before the window, 2500 from Wed 18 Nov.
  await pg.query(
    `insert into nutrition_target_history (user_id, daily_kcal, protein_g, carbs_g, fat_g, set_by_user_id, effective_at) values
      ($1, 2000, 150, 200, 70, null, 'epoch'),
      ($1, 2500, 180, 250, 80, $2, '2026-11-18T12:00:00Z'),
      ($3, 1800, 120, 180, 60, null, 'epoch')`,
    [ATHLETE_C, COACH_B, ATHLETE_E],
  );
  const entry = (user: string, at: string, kcal: number) =>
    pg.query(
      `insert into nutrition_entries (user_id, meal_slot, servings, kcal, protein_g, carbs_g, fat_g, logged_at)
       values ($1, 'lunch', 1, $2, 0, 0, 0, $3)`,
      [user, kcal, at],
    );
  // C, Europe/London. 13–15 unlogged, 16 on (two entries), 17 under,
  // 18 on (new 2500 target), 19 over, 20 is today (never counts).
  await entry(ATHLETE_C, "2026-11-16T08:00:00Z", 1000);
  await entry(ATHLETE_C, "2026-11-16T19:00:00Z", 1000);
  await entry(ATHLETE_C, "2026-11-17T12:00:00Z", 1200);
  await entry(ATHLETE_C, "2026-11-18T12:00:00Z", 2400);
  await entry(ATHLETE_C, "2026-11-19T12:00:00Z", 3200);
  await entry(ATHLETE_C, "2026-11-20T09:00:00Z", 2500);
  // E, New York, coached from 17 Nov: 03:00Z on the 19th is still the 18th.
  await entry(ATHLETE_E, "2026-11-19T03:00:00Z", 1800);
  await entry(ATHLETE_E, "2026-11-19T20:00:00Z", 900);

  legacy.trainers = new Set([COACH_A, COACH_B, COACH_D]);
  legacy.roster = new Map([
    [
      COACH_A,
      [
        legacyClient(ATHLETE_C, REL_AC, "active", 50),
        legacyClient(ATHLETE_E, REL_AE, "active", null),
        legacyClient(USER_U, randomUUID(), "pending", null),
      ],
    ],
    [COACH_B, [legacyClient(ATHLETE_C, REL_BC, "active", 80)]],
  ]);
}

function legacyClient(
  id: string,
  relationshipId: string,
  status: string,
  adherence: number | null,
): Record<string, unknown> {
  return {
    id,
    relationshipId,
    name: "Client",
    initials: "CL",
    avatarUrl: null,
    status,
    initiatedBy: "trainer",
    programLabel: "Strength · Wk 2 / 8",
    programEndDate: null,
    adherence,
    band: adherence === null ? null : "wobbling",
    lastSeenAt: "2026-11-19T18:00:00.000Z",
    flags: [{ tone: "ember", label: "1 MISSED" }],
  };
}

const LEGACY_OVERVIEW = {
  trainer: { name: "Coach A", initials: "CA", coachSince: null },
  businessStats: {
    activeClients: 2,
    newClientsThisMonth: 1,
    slotsTotal: 10,
    slotsOpen: 8,
    avgAdherence: 50,
    adherenceDelta: -5,
    clientPRsThisMonth: 3,
    clientsWithPRs: 1,
    retentionPct: 100,
    churnThisQuarter: 0,
  },
  clientHealthBreakdown: [{ band: "wobbling", count: 1 }],
  programStats: { activeProgramsCount: 1, programs: [] },
  recentActivity: [],
};

const LEGACY_DETAIL = {
  client: { id: "c", name: "Cal" },
  adherence: { overall: 50, band: "wobbling", categories: [] },
  prs: [],
  volume: { weekKg: 1000, daily: [] },
  calorieHit: {
    targetKcal: 2500,
    daysHit: 2,
    daysLogged: 5,
    todayKcal: 2500,
    todayRemainingKcal: 0,
  },
  goal: null,
  habits: null,
  aiSummary: {
    summary: null,
    coversDate: null,
    generatedAt: null,
    canManualRefresh: false,
  },
  thisWeek: {
    workoutsCompleted: 3,
    workoutsPlanned: 4,
    volumeKg: 1000,
    prs: 0,
    checkIns: null,
  },
  recentSessions: [],
  notes: [],
};

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec("create role anon; create role authenticated;");
  db = drizzle(pg, { schema });
  holder.db = db;
});
afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  legacy.overview = structuredClone(LEGACY_OVERVIEW);
  legacy.detail = structuredClone(LEGACY_DETAIL);
  await rebuild();
  await seed();
});
afterEach(() => {
  vi.useRealTimers();
});

const CAL_A_7D = {
  training: {
    from: "2026-11-14",
    to: "2026-11-20",
    target: 4,
    done: 3,
    label: "3 of 4 in the last 7 days",
    state: "behind",
  },
  calories: {
    from: "2026-11-13",
    to: "2026-11-19",
    daysOnTarget: 2,
    daysCounted: 7,
    daysNotLogged: 3,
    daysOver: 1,
    daysUnder: 1,
    perDay: [
      { date: "2026-11-13", kcal: null, targetKcal: 2000, result: "notLogged" },
      { date: "2026-11-14", kcal: null, targetKcal: 2000, result: "notLogged" },
      { date: "2026-11-15", kcal: null, targetKcal: 2000, result: "notLogged" },
      { date: "2026-11-16", kcal: 2000, targetKcal: 2000, result: "on" },
      { date: "2026-11-17", kcal: 1200, targetKcal: 2000, result: "under" },
      { date: "2026-11-18", kcal: 2400, targetKcal: 2500, result: "on" },
      { date: "2026-11-19", kcal: 3200, targetKcal: 2500, result: "over" },
    ],
  },
};

describe("GET /trainers/me/clients/:clientId/adherence", () => {
  it("returns the 7-day report from the real data", async () => {
    const res = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/adherence`,
      COACH_A,
    );
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({
      asOf: NOW.toISOString(),
      windowDays: 7,
      ...CAL_A_7D,
    });
  });

  it("returns 28 days with the target scaled and the read audited", async () => {
    const res = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/adherence?window=28d`,
      COACH_A,
    );
    expect(res.status).toBe(200);
    expect(res.json.data.windowDays).toBe(28);
    expect(res.json.data.training).toMatchObject({
      from: "2026-10-24",
      target: 16,
      done: 4,
    });
    expect(res.json.data.calories.perDay).toHaveLength(28);
    const audit = await pg.query(
      "select data_category from client_data_access_log where trainer_id = $1",
      [COACH_A],
    );
    expect(audit.rows).toEqual([{ data_category: "client_adherence" }]);
  });

  it("rejects an unknown window and an unauthenticated caller", async () => {
    const bad = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/adherence?window=week`,
      COACH_A,
    );
    expect(bad.status).toBe(422);
    const anon = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/adherence`,
      null,
    );
    expect(anon.status).toBe(401);
  });

  it("only counts days since a client started (E, started 17 Nov, New York)", async () => {
    const res = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_E}/adherence`,
      COACH_A,
    );
    expect(res.json.data.training).toBeUndefined();
    expect(
      res.json.data.calories.perDay.map(
        (d: Json) => `${d.date}:${d.result}:${d.kcal}`,
      ),
    ).toEqual([
      "2026-11-13:beforeCoaching:null",
      "2026-11-14:beforeCoaching:null",
      "2026-11-15:beforeCoaching:null",
      "2026-11-16:beforeCoaching:null",
      "2026-11-17:notLogged:null",
      "2026-11-18:on:1800",
      "2026-11-19:under:900",
    ]);
  });
});

describe("design B D6 test 5 — scoping", () => {
  it("gives two coaches their own training target and the same calories", async () => {
    const a = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/adherence`,
      COACH_A,
    );
    const b = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/adherence`,
      COACH_B,
    );
    expect(a.json.data.training).toMatchObject({ target: 4, state: "behind" });
    expect(b.json.data.training).toMatchObject({
      target: 2,
      done: 3,
      state: "met",
      label: "3 of 2 in the last 7 days",
    });
    expect(b.json.data.calories).toEqual(a.json.data.calories);
  });

  it("answers 403 to coach D, a plain user, and coach B for coach A's client", async () => {
    for (const [actor, client, code] of [
      [COACH_D, ATHLETE_C, "not_your_client"],
      [USER_U, ATHLETE_C, "not_a_trainer"],
      [COACH_B, ATHLETE_E, "not_your_client"],
    ] as const) {
      for (const path of [
        `/trainers/me/clients/${client}/adherence`,
        `/trainers/me/clients/${client}`,
      ]) {
        const res = await http("GET", path, actor);
        expect(res.status).toBe(403);
        expect(res.json.code).toBe(code);
      }
    }
  });

  it("stops at an ended relationship", async () => {
    await pg.query(
      "update pt_client_relationships set status = 'ended' where id = $1",
      [REL_AC],
    );
    const res = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/adherence`,
      COACH_A,
    );
    expect(res.status).toBe(403);
    expect(await new AdherenceRepository().load(ATHLETE_C, REL_AC, "7d")).toBe(
      null,
    );
  });

  it("keeps two athletes' data apart in one batched read", async () => {
    const repo = new AdherenceRepository();
    const subjects = await repo.subjectsForTrainer(COACH_A);
    expect(subjects.map((s) => s.clientId).sort()).toEqual(
      [ATHLETE_C, ATHLETE_E].sort(),
    );
    const inputs = await repo.loadMany(subjects, "7d", NOW);
    const c = inputs.get(REL_AC)!;
    const e = inputs.get(REL_AE)!;
    expect([...c.dayKcal.keys()].sort()).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
    ]);
    expect(c.sessions).toHaveLength(3);
    expect([...e.dayKcal.entries()]).toEqual([
      ["2026-11-18", 1800],
      ["2026-11-19", 900],
    ]);
    // E isn't tracked for training, so none of E's sessions are read.
    expect(e.sessions).toEqual([]);
    expect(e.targets.map((t) => t.dailyKcal)).toEqual([1800]);
    expect(e.timeZone).toBe("America/New_York");
    // Coach B's settings never leak into coach A's read, nor the reverse.
    const bSubjects = await repo.subjectsForTrainer(COACH_B);
    expect(bSubjects).toHaveLength(1);
    expect(bSubjects[0]!.settings.sessionsPerWeek).toBe(2);
    expect(
      subjects.find((s) => s.clientId === ATHLETE_C)!.settings.sessionsPerWeek,
    ).toBe(4);
    // A narrowed read only returns the asked-for clients; an empty one reads nothing.
    expect(await repo.subjectsForTrainer(COACH_A, [ATHLETE_E])).toHaveLength(1);
    expect(await repo.subjectsForTrainer(COACH_A, [])).toEqual([]);
    expect((await repo.loadMany([], "7d", NOW)).size).toBe(0);
  });

  it("falls back to London for an unknown stored time zone", async () => {
    await pg.query("update profiles set timezone = 'Not/AZone' where id = $1", [
      ATHLETE_E,
    ]);
    const input = await new AdherenceRepository().load(ATHLETE_E, REL_AE, "7d");
    expect(input!.timeZone).toBe("Europe/London");
  });

  it("handles a tracked client with no sessions, food or target, and no start date", async () => {
    // activated_at null (e.g. a row the PER-108 backfill missed): no limit.
    await pg.query(
      "update pt_client_relationships set activated_at = null where id = $1",
      [REL_AE],
    );
    await pg.query(
      "update coach_client_settings set track_training = true, sessions_per_week = 3 where relationship_id = $1",
      [REL_AE],
    );
    await pg.query("delete from nutrition_entries where user_id = $1", [
      ATHLETE_E,
    ]);
    await pg.query("delete from workout_sessions where user_id = $1", [
      ATHLETE_E,
    ]);
    await pg.query("delete from nutrition_target_history where user_id = $1", [
      ATHLETE_E,
    ]);
    const res = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_E}/adherence`,
      COACH_A,
    );
    expect(res.json.data.training).toMatchObject({
      from: "2026-11-14",
      done: 0,
      target: 3,
      state: "behind",
    });
    expect(res.json.data.calories).toMatchObject({
      daysCounted: 0,
      daysNotLogged: 0,
    });
    expect(
      res.json.data.calories.perDay.every((d: Json) => d.result === "noTarget"),
    ).toBe(true);
  });

  it("treats a relationship with no settings row as nothing tracked", async () => {
    await pg.query(
      "delete from coach_client_settings where relationship_id = $1",
      [REL_AC],
    );
    const res = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/adherence`,
      COACH_A,
    );
    expect(res.json.data).toEqual({ asOf: NOW.toISOString(), windowDays: 7 });
  });
});

describe("design B D6 test 3 — consumers agree", () => {
  it("roster, detail, overview and the route return the same numbers", async () => {
    const route = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/adherence`,
      COACH_A,
    );
    const routeE = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_E}/adherence`,
      COACH_A,
    );
    const roster = await http("GET", "/trainers/me/clients", COACH_A);
    const detail = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}`,
      COACH_A,
    );
    const overview = await http("GET", "/trainers/me/overview", COACH_A);

    const expectedByArea = adherenceByArea(route.json.data);
    expect(expectedByArea).toEqual({
      training: {
        done: 3,
        target: 4,
        label: "3 of 4 in the last 7 days",
        state: "behind",
      },
      calories: { daysOnTarget: 2, daysCounted: 7, daysNotLogged: 3 },
    });

    const rosterC = roster.json.data.find((c: Json) => c.id === ATHLETE_C);
    const rosterE = roster.json.data.find((c: Json) => c.id === ATHLETE_E);
    const pending = roster.json.data.find((c: Json) => c.id === USER_U);
    expect(rosterC.adherenceByArea).toEqual(expectedByArea);
    expect(rosterE.adherenceByArea).toEqual(adherenceByArea(routeE.json.data));
    expect(pending.adherenceByArea).toBeNull();

    expect(detail.status).toBe(200);
    expect(detail.json.data.adherenceByArea).toEqual(expectedByArea);
    expect(detail.json.data.last7Days).toEqual({
      training: route.json.data.training,
      calories: route.json.data.calories,
      checkIn: null,
      forms: null,
      expected: [],
    });

    // Practice level: C (3 of 4, 2 of 7) + E (calories only, 1 of 3).
    expect(overview.json.data.adherenceByArea).toEqual({
      training: { done: 3, target: 4, clients: 1 },
      calories: {
        daysOnTarget: 3,
        daysCounted: 10,
        daysNotLogged: 4,
        clients: 2,
      },
    });
  });

  it("matches computeAdherence over the repository's own input", async () => {
    const input = await new AdherenceRepository().load(
      ATHLETE_C,
      REL_AC,
      "7d",
      NOW,
    );
    expect(computeAdherence(input!)).toEqual({
      asOf: NOW.toISOString(),
      windowDays: 7,
      ...CAL_A_7D,
    });
  });

  it("gives an empty practice level and roster when nothing is tracked", async () => {
    await pg.query(
      "update coach_client_settings set track_training = false, track_calories = false",
    );
    const roster = await http("GET", "/trainers/me/clients", COACH_A);
    const overview = await http("GET", "/trainers/me/overview", COACH_A);
    expect(
      roster.json.data
        .filter((c: Json) => c.status === "active")
        .map((c: Json) => c.adherenceByArea),
    ).toEqual([{}, {}]);
    expect(overview.json.data.adherenceByArea).toEqual({});
    const detail = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}`,
      COACH_A,
    );
    expect(detail.json.data.adherenceByArea).toEqual({});
    expect(detail.json.data.last7Days).toEqual({
      training: null,
      calories: null,
      checkIn: null,
      forms: null,
      expected: [],
    });
  });

  it("returns 403 from the roster and overview for a non-trainer", async () => {
    expect((await http("GET", "/trainers/me/clients", USER_U)).status).toBe(
      403,
    );
    expect((await http("GET", "/trainers/me/overview", USER_U)).status).toBe(
      403,
    );
  });

  it("handles a coach with no clients", async () => {
    const roster = await http("GET", "/trainers/me/clients", COACH_D);
    const overview = await http("GET", "/trainers/me/overview", COACH_D);
    expect(roster.json.data).toEqual([]);
    expect(overview.json.data.adherenceByArea).toEqual({});
  });
});

describe("design B D6 test 4 — 1.2.0 contract", () => {
  it("keeps every roster field the 1.2.0 bundle reads, unchanged", async () => {
    const res = await http("GET", "/trainers/me/clients", COACH_A);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.data)).toBe(true);
    const before = legacy.roster.get(COACH_A)!;
    expect(res.json.data).toHaveLength(before.length);
    res.json.data.forEach((item: Json, i: number) => {
      const { adherenceByArea: added, ...rest } = item;
      expect(rest).toEqual(before[i]);
      for (const field of contract.trainerClients.itemFields) {
        expect(item[field]).toEqual(before[i]![field]);
      }
      expect(added === null || typeof added === "object").toBe(true);
    });
  });

  it("keeps every overview field the 1.2.0 bundle reads, unchanged", async () => {
    const res = await http("GET", "/trainers/me/overview", COACH_A);
    const { adherenceByArea: added, ...rest } = res.json.data;
    expect(rest).toEqual(LEGACY_OVERVIEW);
    expect(added).toHaveProperty("calories");
    for (const field of contract.coachOverview.fields) {
      expect(res.json.data[field]).toEqual(
        (LEGACY_OVERVIEW as Record<string, unknown>)[field],
      );
    }
    for (const field of contract.coachOverview.businessStatsFields) {
      expect(res.json.data.businessStats[field]).toEqual(
        (LEGACY_OVERVIEW.businessStats as Record<string, unknown>)[field],
      );
    }
  });

  it("keeps every client detail field the 1.2.0 bundle reads, unchanged", async () => {
    const res = await http("GET", `/trainers/me/clients/${ATHLETE_C}`, COACH_A);
    const { adherenceByArea: byArea, last7Days: week, ...rest } = res.json.data;
    expect(rest).toEqual(LEGACY_DETAIL);
    expect(byArea).toHaveProperty("training");
    expect(week).toHaveProperty("calories");
    for (const field of contract.clientDetail.fields) {
      expect(res.json.data).toHaveProperty(field);
    }
    for (const field of contract.clientDetail.adherenceFields) {
      expect(res.json.data.adherence[field]).toEqual(
        (LEGACY_DETAIL.adherence as Record<string, unknown>)[field],
      );
    }
    for (const field of contract.clientDetail.calorieHitFields) {
      expect(res.json.data.calorieHit[field]).toEqual(
        (LEGACY_DETAIL.calorieHit as Record<string, unknown>)[field],
      );
    }
    // The detail read is still audited under its own category.
    const audit = await pg.query(
      "select data_category from client_data_access_log where client_id = $1",
      [ATHLETE_C],
    );
    expect(audit.rows).toEqual([{ data_category: "client_detail_aggregate" }]);
  });
});

async function historyRows(userId: string): Promise<Json[]> {
  const res = await pg.query(
    `select daily_kcal::float as kcal, protein_g::float as protein, set_by_user_id, effective_at
     from nutrition_target_history where user_id = $1 order by effective_at, created_at`,
    [userId],
  );
  return res.rows as Json[];
}

describe("design B D6 test 2 — the history trigger", () => {
  it("records an old-shape self PUT /nutrition/targets", async () => {
    const first = await http("PUT", "/nutrition/targets", USER_U, TARGET);
    expect(first.status).toBe(200);
    expect(first.json.data.dailyKcal).toBe(2000);
    const second = await http("PUT", "/nutrition/targets", USER_U, {
      ...TARGET,
      dailyKcal: 2200,
    });
    expect(second.status).toBe(200);
    const rows = await historyRows(USER_U);
    expect(rows.map((r) => [r.kcal, r.set_by_user_id])).toEqual([
      [2000, null],
      [2200, null],
    ]);
  });

  it("records the coach PUT …/nutrition/target with who set it", async () => {
    const res = await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/nutrition/target`,
      COACH_B,
      { ...TARGET, dailyKcal: 2600 },
    );
    expect(res.status).toBe(200);
    const rows = await historyRows(ATHLETE_C);
    const last = rows[rows.length - 1];
    expect(last.kcal).toBe(2600);
    expect(last.set_by_user_id).toBe(COACH_B);
  });

  it("writes nothing for other columns or an unchanged re-save", async () => {
    await http("PUT", "/nutrition/targets", USER_U, TARGET);
    await http("PUT", "/nutrition/targets", USER_U, TARGET);
    await http("PUT", "/nutrition/targets", USER_U, {
      ...TARGET,
      waterCups: 10,
      preset: "cut",
    });
    await pg.query(
      "update nutrition_targets set set_by_user_id = $1, updated_at = now() where user_id = $2",
      [COACH_A, USER_U],
    );
    expect(await historyRows(USER_U)).toHaveLength(1);
    // A macro-only change is still a change.
    await http("PUT", "/nutrition/targets", USER_U, {
      ...TARGET,
      proteinG: 160,
    });
    const rows = await historyRows(USER_U);
    expect(rows.map((r) => r.protein)).toEqual([150, 160]);
  });

  it("is read back by targetsInForceSince with the row in force at the start", async () => {
    const since = new Date("2026-11-13T00:00:00Z");
    const map = await new AdherenceRepository().targetsInForceSince(
      [ATHLETE_C, ATHLETE_E, USER_U],
      since,
    );
    expect(map.get(ATHLETE_C)!.map((r) => r.dailyKcal)).toEqual([2000, 2500]);
    expect(map.get(ATHLETE_C)![1]).toMatchObject({
      proteinG: 180,
      carbsG: 250,
      fatG: 80,
      setByUserId: COACH_B,
    });
    expect(map.get(USER_U)).toBeUndefined();
    const resolve = targetResolver(map.get(ATHLETE_C)!, "Europe/London");
    expect(resolve("2026-11-17")).toBe(2000);
    expect(resolve("2026-11-18")).toBe(2500);
    expect(
      (await new AdherenceRepository().targetsInForceSince([], since)).size,
    ).toBe(0);
  });
});

describe("migration 20261121000100_nutrition_target_history.sql", () => {
  async function targetsTable(): Promise<Json[]> {
    return (
      await pg.query(
        "select user_id, daily_kcal::text, protein_g::text, set_by_user_id from nutrition_targets order by user_id",
      )
    ).rows as Json[];
  }

  it("backfills an epoch row per existing target, and a re-run is a no-op", async () => {
    await rebuild(false);
    await seedProfilesOnly();
    await pg.query(
      `insert into nutrition_targets (user_id, daily_kcal, protein_g, carbs_g, fat_g, set_by_user_id) values
        ($1, 2000, 150, 200, 70, $3), ($2, 1800, 120, 180, 60, null)`,
      [ATHLETE_C, ATHLETE_E, COACH_A],
    );
    const before = await targetsTable();

    const forward = await read(MIGRATIONS, MIGRATION);
    await pg.exec(forward);
    const once = await pg.query(
      "select user_id, daily_kcal::float as kcal, set_by_user_id, effective_at from nutrition_target_history order by user_id",
    );
    expect(once.rows).toHaveLength(2);
    for (const row of once.rows as Json[]) {
      expect(new Date(row.effective_at).getTime()).toBe(0);
    }
    expect(
      (once.rows as Json[]).find((r) => r.user_id === ATHLETE_C).set_by_user_id,
    ).toBe(COACH_A);

    await pg.exec(forward);
    const twice = await pg.query(
      "select user_id, daily_kcal::float as kcal, set_by_user_id, effective_at from nutrition_target_history order by user_id",
    );
    expect(twice.rows).toEqual(once.rows);
    expect(await targetsTable()).toEqual(before);

    // A target first written after the trigger existed gets no epoch row on re-run.
    await pg.query(
      `insert into nutrition_targets (user_id, daily_kcal, protein_g, carbs_g, fat_g) values ($1, 2100, 1, 1, 1)`,
      [USER_U],
    );
    await pg.exec(forward);
    const u = await pg.query(
      "select effective_at from nutrition_target_history where user_id = $1",
      [USER_U],
    );
    expect(u.rows).toHaveLength(1);
    expect(new Date((u.rows[0] as Json).effective_at).getTime()).not.toBe(0);
  });

  it("rolls back and forward again without touching nutrition_targets", async () => {
    await rebuild(false);
    await seedProfilesOnly();
    await pg.query(
      `insert into nutrition_targets (user_id, daily_kcal, protein_g, carbs_g, fat_g) values ($1, 2000, 150, 200, 70)`,
      [ATHLETE_C],
    );
    const before = await targetsTable();
    const forward = await read(MIGRATIONS, MIGRATION);
    await pg.exec(forward);
    await pg.exec(await read(ROLLBACKS, MIGRATION));
    const gone = await pg.query(
      "select 1 from pg_tables where tablename = 'nutrition_target_history'",
    );
    expect(gone.rows).toEqual([]);
    const trigger = await pg.query(
      "select 1 from pg_trigger where tgname = 'nutrition_targets_record_history'",
    );
    expect(trigger.rows).toEqual([]);
    // Writes still work with no trigger.
    await pg.query(
      "update nutrition_targets set daily_kcal = 2100 where user_id = $1",
      [ATHLETE_C],
    );
    await pg.query(
      "update nutrition_targets set daily_kcal = 2000 where user_id = $1",
      [ATHLETE_C],
    );
    expect(await targetsTable()).toEqual(before);

    await pg.exec(forward);
    expect(await historyRows(ATHLETE_C)).toHaveLength(1);
    await pg.query(
      "update nutrition_targets set daily_kcal = 2300 where user_id = $1",
      [ATHLETE_C],
    );
    expect((await historyRows(ATHLETE_C)).map((r) => r.kcal)).toEqual([
      2000, 2300,
    ]);
  });

  it("has the index, RLS on, and cascades with the athlete's profile", async () => {
    const idx = await pg.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where indexname = 'nutrition_target_history_user_effective_idx'",
    );
    expect(idx.rows[0]!.indexdef).toContain("(user_id, effective_at DESC)");
    const rls = await pg.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'nutrition_target_history'",
    );
    expect(rls.rows[0]!.relrowsecurity).toBe(true);
    // FKs aren't in the Drizzle-built base tables, so check the declared ones.
    const fks = await pg.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid = 'nutrition_target_history'::regclass and contype = 'f' order by 1`,
    );
    expect(fks.rows.map((r) => r.def)).toEqual([
      "FOREIGN KEY (set_by_user_id) REFERENCES profiles(id) ON DELETE SET NULL",
      "FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE",
    ]);
  });
});

async function seedProfilesOnly(): Promise<void> {
  await pg.query(
    `insert into profiles (id, role, timezone) values
      ($1, 'personal_trainer', 'Europe/London'),
      ($2, 'user', 'Europe/London'),
      ($3, 'user', 'America/New_York'),
      ($4, 'user', 'Europe/London')`,
    [COACH_A, ATHLETE_C, ATHLETE_E, USER_U],
  );
}
