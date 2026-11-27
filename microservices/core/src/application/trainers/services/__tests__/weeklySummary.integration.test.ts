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
 * PER-115 (BE-B2) — the AI weekly summary by area, end to end on PGlite with
 * the shipped migrations (PER-108's coaching migration, PER-114's target
 * history and this ticket's migration 3), through the real handler, scope
 * check, evidence repository, adherence calculation, cache and usage log.
 *
 * Stubbed edges only: the JWT (bearer token = user id), the coach's
 * entitlement and AI budget (own suites), and the Bedrock SDK — no real AI
 * provider is ever called; `sdk.create` counts every call that would have
 * reached it. Covers design B D6 test 6 (first week: zero AI calls), the 1.2.0
 * contract fixture, scoping between two coaches, the evidence rules (never
 * photos, only this coach's forms and plans), strict parsing, and the
 * migration forward twice, down and up.
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
vi.mock("../../../entitlement/assertEntitlement", async (original) => ({
  ...(await original<object>()),
  assertEntitlement: async () => ({ allowed: true }),
}));
vi.mock("../../../ai/aiBudget", () => ({
  AI_BUDGET_EXHAUSTED_BODY: { error: "ai_budget_exhausted" },
  hasAiBudget: async () => true,
}));
const sdk = vi.hoisted(() => ({
  create: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
}));
vi.mock("@anthropic-ai/bedrock-sdk", () => ({
  AnthropicBedrock: class {
    maxRetries = 0;
    messages = {
      create: (...args: unknown[]) =>
        (sdk.create as (...a: unknown[]) => unknown)(...args),
    };
  },
}));

import Elysia from "elysia";
import { coreErrorHandler } from "../../../../shared/errorHandler";
import { trainersMeGenerateClientAiSummaryHandler } from "../../clients/trainersMeGenerateClientAiSummaryHandler";
import { resolveCoachScope } from "../../../relationships/resolveCoachScope";
import { loadWeeklySummaryEvidence } from "../weeklySummaryEvidenceRepository";
import contract from "./fixtures/contract-1.2.0-ai-summary.json";

const MIGRATIONS = "../../../../../../../supabase/migrations/";
const ROLLBACKS = "../../../../../../../supabase/rollbacks/";
const read = (dir: string, file: string) =>
  readFile(new URL(`${dir}${file}`, import.meta.url), "utf8");
const MIGRATION = "20261126120402_client_ai_summary_areas.sql";

const dialect = new PgDialect();

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
  schema.aiUsageLog,
  schema.coachForms,
  schema.coachFormVersions,
  schema.coachFormRequests,
  schema.coachFormResponses,
  schema.nutritionPlans,
  schema.nutritionPlanAssignments,
];

/** Same helper as the PER-114 suite: columns, defaults, plain uniques. */
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

/** client_ai_summaries as it was before migration 3. */
const DROP_NEW_COLUMNS =
  "alter table client_ai_summaries drop column headline, drop column areas, drop column ask, drop column week_of_programme;";

async function rebuild(withMigration = true): Promise<void> {
  await pg.exec(
    "drop schema if exists public cascade; drop schema if exists auth cascade; create schema public; create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';",
  );
  for (const table of BASE_TABLES) await pg.exec(ddl(table));
  await pg.exec(
    "alter table pt_client_relationships drop column activated_at, drop column client_profile_id;",
  );
  await pg.exec(DROP_NEW_COLUMNS);
  await pg.exec(
    await read(MIGRATIONS, "20260626110000_trainer_invite_codes.sql"),
  );
  await pg.exec(
    await read(
      MIGRATIONS,
      "20261120120000_coaching_relationships_client_profiles.sql",
    ),
  );
  await pg.exec(
    await read(MIGRATIONS, "20261121000100_nutrition_target_history.sql"),
  );
  if (withMigration) await pg.exec(await read(MIGRATIONS, MIGRATION));
}

// Thursday 26 Nov 2026, 10:00 GMT. Only `Date` is faked.
const NOW = new Date("2026-11-26T10:00:00Z");

const COACH_A = randomUUID();
const COACH_B = randomUUID();
const COACH_D = randomUUID();
const ATHLETE_C = randomUUID();
const ATHLETE_N = randomUUID();
const REL_AC = randomUUID();
const REL_BC = randomUUID();
const REL_AN = randomUUID();
const PLAN_A = randomUUID();
const PLAN_B = randomUUID();
const MEAL_1 = randomUUID();
const MEAL_2 = randomUUID();

const app = new Elysia()
  .use(coreErrorHandler)
  .use(trainersMeGenerateClientAiSummaryHandler);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function summary(
  actor: string,
  clientId: string,
  body: unknown = {},
): Promise<{ status: number; json: Json }> {
  const res = await app.handle(
    new Request(`http://localhost/trainers/me/clients/${clientId}/ai-summary`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${actor}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const MODEL_OUTPUT = {
  headline: "Good week, one session short.",
  areas: [
    { area: "training", status: "check", text: "3 of 4 sessions." },
    { area: "calories", status: "good", text: "4 of 7 days on target." },
    { area: "checkIns", status: "info", text: "Energy 4/5, squat PR." },
    { area: "mealPlan", status: "good", text: "2 plan meals on 2 days." },
  ],
  ask: "Ask how the squat PR felt.",
};

function toolResponse(input: unknown) {
  return {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", name: "report_summary", input }],
  };
}

async function count(table: string): Promise<number> {
  const r = await pg.query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return r.rows[0]!.n;
}

async function seed(): Promise<void> {
  await pg.query(
    `insert into profiles (id, role, full_name, timezone) values
      ($1, 'personal_trainer', 'Coach A', 'Europe/London'),
      ($2, 'personal_trainer', 'Coach B', 'Europe/London'),
      ($3, 'personal_trainer', 'Coach D', 'Europe/London'),
      ($4, 'user', 'Cal', 'Europe/London'),
      ($5, 'user', 'Nia', 'Europe/London')`,
    [COACH_A, COACH_B, COACH_D, ATHLETE_C, ATHLETE_N],
  );
  await pg.query(
    `insert into pt_client_relationships (id, trainer_id, client_id, status, activated_at) values
      ($1, $4, $6, 'active', '2026-09-01T09:00:00Z'),
      ($2, $5, $6, 'active', '2026-09-01T09:00:00Z'),
      ($3, $4, $7, 'active', '2026-11-25T10:00:00Z')`,
    [REL_AC, REL_BC, REL_AN, COACH_A, COACH_B, ATHLETE_C, ATHLETE_N],
  );
  await pg.query(
    `insert into coach_client_settings (relationship_id, trainer_id, client_id, track_training, track_calories, sessions_per_week, features) values
      ($1, $4, $6, true, true, 4, '{}'),
      ($2, $5, $6, true, true, 2, '{"checkIns": false, "nutrition": false}'),
      ($3, $4, $7, true, true, 3, '{}')`,
    [REL_AC, REL_BC, REL_AN, COACH_A, COACH_B, ATHLETE_C, ATHLETE_N],
  );

  // Training window Fri 20 – Thu 26: three completed, one before it.
  await pg.query(
    `insert into workout_sessions (user_id, status, completed_at) values
      ($1, 'completed', '2026-11-18T18:00:00Z'),
      ($1, 'completed', '2026-11-20T08:00:00Z'),
      ($1, 'completed', '2026-11-23T18:00:00Z'),
      ($1, 'completed', '2026-11-25T18:00:00Z')`,
    [ATHLETE_C],
  );

  // Calories window Thu 19 – Wed 25 against 2000: on 19, over 20, under 21,
  // not logged 22, on 23, on 24 (two plan items), on 25. Today never counts.
  await pg.query(
    `insert into nutrition_target_history (user_id, daily_kcal, protein_g, carbs_g, fat_g, set_by_user_id, effective_at)
     values ($1, 2000, 150, 200, 70, null, 'epoch')`,
    [ATHLETE_C],
  );
  const entry = (
    at: string,
    kcal: number,
    plan: string | null = null,
    meal: string | null = null,
  ) =>
    pg.query(
      `insert into nutrition_entries (user_id, meal_slot, servings, kcal, protein_g, carbs_g, fat_g, logged_at, source_plan_id, source_plan_meal_id)
       values ($1, 'lunch', 1, $2, 0, 0, 0, $3, $4, $5)`,
      [ATHLETE_C, kcal, at, plan, meal],
    );
  await entry("2026-11-19T12:00:00Z", 2000);
  await entry("2026-11-20T12:00:00Z", 2600);
  await entry("2026-11-21T12:00:00Z", 1500);
  await entry("2026-11-23T12:00:00Z", 2100);
  await entry("2026-11-24T08:00:00Z", 900, PLAN_A, MEAL_1);
  await entry("2026-11-24T08:01:00Z", 900, PLAN_A, MEAL_1);
  await entry("2026-11-25T12:00:00Z", 2000, PLAN_A, MEAL_2);
  await entry("2026-11-26T08:00:00Z", 500, PLAN_A, MEAL_1);
  // From coach B's plan: never part of coach A's evidence.
  await entry("2026-11-25T19:00:00Z", 0, PLAN_B, randomUUID());

  await pg.query(
    `insert into nutrition_plans (id, owner_id, name, source) values
      ($1, $3, 'Cut', 'coach'), ($2, $4, 'Bulk', 'coach')`,
    [PLAN_A, PLAN_B, COACH_A, COACH_B],
  );
  await pg.query(
    `insert into nutrition_plan_assignments (plan_id, trainer_id, client_id, relationship_id, status) values
      ($1, $3, $5, $6, 'added'), ($2, $4, $5, $7, 'added')`,
    [PLAN_A, PLAN_B, COACH_A, COACH_B, ATHLETE_C, REL_AC, REL_BC],
  );

  // Coach A's 8-week dated programme from Mon 9 Nov: week 3 of 8.
  const programId = randomUUID();
  await pg.query(
    `insert into workout_programs (id, name, duration_weeks, days_per_week, created_by) values ($1, 'Strength', 8, 3, $2)`,
    [programId, COACH_A],
  );
  await pg.query(
    `insert into program_assignments (program_id, client_id, assigned_by, start_date, end_date, status)
     values ($1, $2, $3, '2026-11-09', '2027-01-03', 'started')`,
    [programId, ATHLETE_C, COACH_A],
  );

  // Forms: A's latest (with a photo answer), A's older one, and B's.
  const form = async (
    trainer: string,
    rel: string,
    title: string,
    sentAt: string,
    submittedAt: string,
    answers: Record<string, unknown>,
    late = false,
  ) => {
    const formId = randomUUID();
    const versionId = randomUUID();
    const requestId = randomUUID();
    await pg.query(
      `insert into coach_forms (id, trainer_id, title, current_version_id) values ($1, $2, $3, $4)`,
      [formId, trainer, title, versionId],
    );
    await pg.query(
      `insert into coach_form_versions (id, form_id, version, questions) values ($1, $2, 1, $3)`,
      [
        versionId,
        formId,
        JSON.stringify([
          { id: "energy", type: "scale", prompt: "Energy", required: true },
          {
            id: "front",
            type: "photo",
            prompt: "Front photo",
            required: false,
          },
          { id: "wins", type: "short_text", prompt: "Wins", required: false },
        ]),
      ],
    );
    await pg.query(
      `insert into coach_form_requests (id, trainer_id, client_id, relationship_id, form_id, form_version_id, trigger, period_key, sent_at, status, late)
       values ($1, $2, $3, $4, $5, $6, 'schedule', $7, $8, 'completed', $9)`,
      [
        requestId,
        trainer,
        ATHLETE_C,
        rel,
        formId,
        versionId,
        sentAt,
        sentAt,
        late,
      ],
    );
    await pg.query(
      `insert into coach_form_responses (request_id, client_id, answers, submitted_at) values ($1, $2, $3, $4)`,
      [requestId, ATHLETE_C, JSON.stringify(answers), submittedAt],
    );
  };
  await form(
    COACH_A,
    REL_AC,
    "Weekly check-in",
    "2026-11-23T09:00:00Z",
    "2026-11-24T19:00:00Z",
    { energy: 4, front: ["media-1"], wins: "Hit a squat PR" },
    true,
  );
  await form(
    COACH_A,
    REL_AC,
    "Old check-in",
    "2026-11-10T09:00:00Z",
    "2026-11-12T19:00:00Z",
    { energy: 2 },
  );
  await form(
    COACH_B,
    REL_BC,
    "Coach B form",
    "2026-11-24T09:00:00Z",
    "2026-11-25T19:00:00Z",
    { energy: 1, wins: "For coach B only" },
  );
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec("create role anon; create role authenticated;");
  db = drizzle(pg, { schema });
  holder.db = db;
  // postgres.js returns raw `execute` rows as an array; PGlite wraps them.
  const execute = db.execute.bind(db);
  vi.spyOn(db, "execute").mockImplementation(
    (async (query: Parameters<typeof execute>[0]) =>
      (await execute(query)).rows) as unknown as typeof db.execute,
  );
});
afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  sdk.create = vi.fn(async () => toolResponse(MODEL_OUTPUT));
  await rebuild();
  await seed();
});
afterEach(() => {
  vi.useRealTimers();
});

const CAL_EVIDENCE = {
  daysOnTarget: 4,
  daysCounted: 7,
  daysNotLogged: 1,
  daysOver: 1,
  daysUnder: 1,
};

async function scopeFor(trainer: string, client: string) {
  const r = await resolveCoachScope(trainer, client);
  if (!r.allowed) throw new Error("no scope");
  return r.scope;
}

describe("evidence (design B D4)", () => {
  it("coach A: tracked adherence, programme week, latest form answers without photos, plan meals", async () => {
    const evidence = await loadWeeklySummaryEvidence(
      await scopeFor(COACH_A, ATHLETE_C),
      "Europe/London",
      NOW,
    );
    expect(evidence).toEqual({
      training: { done: 3, target: 4, state: "behind" },
      calories: CAL_EVIDENCE,
      programme: { week: 3, of: 8 },
      checkIns: [
        {
          title: "Weekly check-in",
          submittedOn: "2026-11-24",
          late: true,
          answers: [
            { q: "Energy", a: "4/5" },
            { q: "Wins", a: "Hit a squat PR" },
          ],
        },
      ],
      mealPlan: { plans: 1, mealsLogged: 2, days: 2 },
    });
    const text = JSON.stringify(evidence);
    expect(text).not.toContain("media-1");
    expect(text).not.toContain("photo");
    expect(text).not.toContain("For coach B only");
  });

  it("coach B: own training target, the same calories, nothing from coach A, and switched-off areas absent", async () => {
    const evidence = await loadWeeklySummaryEvidence(
      await scopeFor(COACH_B, ATHLETE_C),
      "Europe/London",
      NOW,
    );
    expect(evidence).toEqual({
      training: { done: 3, target: 2, state: "met" },
      calories: CAL_EVIDENCE,
    });
  });
});

describe("evidence windows and the coaching start", () => {
  it("a client who started yesterday: only days since starting count, and plan meals before it don't", async () => {
    await pg.query(
      `insert into nutrition_plan_assignments (plan_id, trainer_id, client_id, relationship_id, status)
       values ($1, $2, $3, $4, 'added')`,
      [PLAN_A, COACH_A, ATHLETE_N, REL_AN],
    );
    const at = (iso: string, meal: string) =>
      pg.query(
        `insert into nutrition_entries (user_id, meal_slot, servings, kcal, protein_g, carbs_g, fat_g, logged_at, source_plan_id, source_plan_meal_id)
         values ($1, 'lunch', 1, 600, 0, 0, 0, $2, $3, $4)`,
        [ATHLETE_N, iso, PLAN_A, meal],
      );
    await at("2026-11-24T12:00:00Z", MEAL_1); // before coaching started
    await at("2026-11-25T12:00:00Z", MEAL_1);
    const evidence = await loadWeeklySummaryEvidence(
      await scopeFor(COACH_A, ATHLETE_N),
      "Europe/London",
      NOW,
    );
    expect(evidence.mealPlan).toEqual({ plans: 1, mealsLogged: 1, days: 1 });
    expect(evidence.checkIns).toBeUndefined();
    // N has no target, so no calorie day counts; no sessions logged.
    expect(evidence.training).toEqual({ done: 0, target: 3, state: "behind" });
    expect(evidence.calories?.daysCounted).toBe(0);
  });

  it("a relationship with no activated_at reads every form and plan meal in the window", async () => {
    await pg.query(
      "update pt_client_relationships set activated_at = null where id = $1",
      [REL_AC],
    );
    const evidence = await loadWeeklySummaryEvidence(
      await scopeFor(COACH_A, ATHLETE_C),
      "Europe/London",
      NOW,
    );
    expect(evidence.checkIns).toHaveLength(1);
    expect(evidence.mealPlan).toEqual({ plans: 1, mealsLogged: 2, days: 2 });
  });

  it("forms sent before the current coaching cycle are not evidence", async () => {
    await pg.query(
      "update pt_client_relationships set activated_at = '2026-11-24T00:00:00Z' where id = $1",
      [REL_AC],
    );
    const evidence = await loadWeeklySummaryEvidence(
      await scopeFor(COACH_A, ATHLETE_C),
      "Europe/London",
      NOW,
    );
    // The check-in was sent on the 23rd, before the cycle restarted.
    expect(evidence.checkIns).toBeUndefined();
  });
});

describe("POST /trainers/me/clients/:clientId/ai-summary", () => {
  it("generates the summary by area, caches it with the legacy paragraph, and serves the cache after", async () => {
    const first = await summary(COACH_A, ATHLETE_C);
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({
      state: "ready",
      coversDate: "2026-11-25",
      headline: MODEL_OUTPUT.headline,
      areas: MODEL_OUTPUT.areas,
      ask: MODEL_OUTPUT.ask,
      weekOfProgramme: { week: 3, of: 8 },
      summary:
        "Good week, one session short. 3 of 4 sessions. 4 of 7 days on target. Energy 4/5, squat PR. 2 plan meals on 2 days.",
      canManualRefresh: true,
    });
    expect(sdk.create).toHaveBeenCalledTimes(1);
    const params = (sdk.create.mock.calls[0] as Json[])[0];
    expect(
      params.tools[0].input_schema.properties.areas.items.properties.area.enum,
    ).toEqual(["training", "calories", "checkIns", "mealPlan"]);

    const rows = await pg.query<Json>(
      "select summary, headline, areas, ask, week_of_programme, refresh_count from client_ai_summaries",
    );
    expect(rows.rows).toEqual([
      {
        summary: first.json.data.summary,
        headline: MODEL_OUTPUT.headline,
        areas: MODEL_OUTPUT.areas,
        ask: MODEL_OUTPUT.ask,
        week_of_programme: { week: 3, of: 8 },
        refresh_count: 0,
      },
    ]);
    expect(await count("ai_usage_log")).toBe(1);

    const again = await summary(COACH_A, ATHLETE_C);
    expect(again.json.data).toMatchObject({
      state: "ready",
      headline: MODEL_OUTPUT.headline,
      areas: MODEL_OUTPUT.areas,
      weekOfProgramme: { week: 3, of: 8 },
    });
    expect(sdk.create).toHaveBeenCalledTimes(1);
  });

  it("coach B is offered only its own areas; an area the model adds anyway is dropped", async () => {
    const res = await summary(COACH_B, ATHLETE_C);
    expect(res.status).toBe(200);
    expect(res.json.data.areas.map((a: Json) => a.area)).toEqual([
      "training",
      "calories",
    ]);
    expect(res.json.data.weekOfProgramme).toBeNull();
  });

  it("a parse failure answers ai_unavailable with the facts — no cache row, never invented text", async () => {
    sdk.create = vi.fn(async () => toolResponse({ summary: "free text" }));
    const res = await summary(COACH_A, ATHLETE_C);
    expect(res.status).toBe(503);
    expect(res.json.error).toBe("ai_unavailable");
    expect(res.json.facts.training).toEqual({
      done: 3,
      target: 4,
      state: "behind",
    });
    expect(JSON.stringify(res.json)).not.toContain("free text");
    expect(await count("client_ai_summaries")).toBe(0);
  });

  it("coach D (no relationship) gets 403 and nothing is read or called", async () => {
    const res = await summary(COACH_D, ATHLETE_C);
    expect(res.status).toBe(403);
    expect(sdk.create).not.toHaveBeenCalled();
    expect(await count("client_data_access_log")).toBe(0);
  });

  describe("first week (design B D6 test 6)", () => {
    it.each([
      ["a Monday", "2026-11-23T10:00:00Z", "2026-11-30"],
      ["a Wednesday", "2026-11-25T10:00:00Z", "2026-12-07"],
      ["a Sunday", "2026-11-22T10:00:00Z", "2026-11-30"],
    ])(
      "activated on %s → firstWeek, firstSummaryOn %s, zero AI calls, no quota, no row",
      async (_day, activatedAt, due) => {
        await pg.query(
          "update pt_client_relationships set activated_at = $1 where id = $2",
          [activatedAt, REL_AN],
        );
        const res = await summary(COACH_A, ATHLETE_N, { manual: true });
        expect(res.status).toBe(200);
        expect(res.json.data).toMatchObject({
          state: "firstWeek",
          firstSummaryOn: due,
          summary: null,
        });
        expect(sdk.create).not.toHaveBeenCalled();
        expect(await count("ai_usage_log")).toBe(0);
        expect(await count("client_ai_summaries")).toBe(0);
      },
    );
  });

  describe("1.2.0 contract", () => {
    const typeOf = (v: unknown) => (v === null ? "null" : typeof v);
    const check = (data: Record<string, unknown>) => {
      for (const [field, types] of Object.entries(contract.fields)) {
        expect(field in data).toBe(true);
        expect(types.split("|")).toContain(typeOf(data[field]));
      }
    };

    it("ready, cached and first-week answers keep every 1.2.0 field and type", async () => {
      const ready = await summary(COACH_A, ATHLETE_C);
      expect(contract.successEnvelope in ready.json).toBe(true);
      check(ready.json.data);
      expect(typeof ready.json.data.summary).toBe("string");
      check((await summary(COACH_A, ATHLETE_C)).json.data);
      const firstWeek = await summary(COACH_A, ATHLETE_N);
      check(firstWeek.json.data);
      // 1.2.0 renders summary: null as its empty state.
      expect(firstWeek.json.data.summary).toBeNull();
    });

    it("ai_unavailable keeps its error field", async () => {
      sdk.create = vi.fn(async () => {
        throw Object.assign(new Error("bad request"), { status: 400 });
      });
      const res = await summary(COACH_A, ATHLETE_C);
      expect(res.status).toBe(503);
      for (const [field, type] of Object.entries(contract.errorFields)) {
        expect(typeOf(res.json[field])).toBe(type);
      }
      expect(res.json.error).toBe("ai_unavailable");
    });
  });
});

describe(`migration ${MIGRATION}`, () => {
  it("runs forward twice, down and up; existing rows keep their summary", async () => {
    await rebuild(false);
    await pg.query(
      `insert into client_ai_summaries (trainer_id, client_id, covers_date, summary, model)
       values ($1, $2, '2026-11-20', 'Old paragraph.', 'm')`,
      [COACH_A, ATHLETE_C],
    );
    const forward = await read(MIGRATIONS, MIGRATION);
    const rollback = await read(ROLLBACKS, MIGRATION);
    const cols = async () =>
      (
        await pg.query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_name = 'client_ai_summaries'
              and column_name in ('headline', 'areas', 'ask', 'week_of_programme')
            order by column_name`,
        )
      ).rows.map((r) => r.column_name);

    await pg.exec(forward);
    await pg.exec(forward);
    expect(await cols()).toEqual([
      "areas",
      "ask",
      "headline",
      "week_of_programme",
    ]);
    expect(
      (
        await pg.query(
          "select summary, headline, areas, ask, week_of_programme from client_ai_summaries",
        )
      ).rows,
    ).toEqual([
      {
        summary: "Old paragraph.",
        headline: null,
        areas: null,
        ask: null,
        week_of_programme: null,
      },
    ]);

    await pg.exec(rollback);
    expect(await cols()).toEqual([]);
    expect(
      (await pg.query("select summary from client_ai_summaries")).rows,
    ).toEqual([{ summary: "Old paragraph." }]);

    await pg.exec(forward);
    expect(await cols()).toHaveLength(4);
  });
});
