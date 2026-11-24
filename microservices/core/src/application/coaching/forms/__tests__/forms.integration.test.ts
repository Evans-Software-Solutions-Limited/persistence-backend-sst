import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { and, eq, is, SQL } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "@persistence/db/schema";

/**
 * PER-116 (BE-C1) — design C's D7 tests 1, 4, 5, 6, 8 and 10, run against the
 * REAL migrations (PER-108's and this one) on PGlite through the real HTTP
 * handlers, accept flow and offboarding. Only the edges are stubbed: the JWT
 * (bearer token = user id), push delivery and the seat evaluator.
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
vi.mock("../../../notifications/push/notificationDispatcher", () => ({
  NotificationDispatcher: class {
    createAndDispatch = vi.fn(async () => ({}));
    dispatchExisting = vi.fn(async () => {});
  },
}));
vi.mock("../../../trainers/seats/trainerSeats", async (original) => ({
  ...(await original<object>()),
  evaluateTrainerJoinSeat: async () => ({ allowed: true }),
  evaluateTrainerClientsActiveSeat: async () => ({ allowed: true }),
  assertTrainerCanInvite: async () => {},
  notifyTrainerClientLimitReached: vi.fn(async () => {}),
}));

vi.mock("../../../entitlement/assertEntitlement", async (original) => ({
  ...(await original<object>()),
  evaluateTrainerClientsActiveSeat: async () => ({ allowed: true }),
}));

import Elysia from "elysia";
import { coreErrorHandler } from "../../../../shared/errorHandler";
import { coachingRoutes } from "../../../coachingRoutes";
import { trainersAcceptInviteCodeHandler } from "../../../trainers/invite-codes/trainersAcceptInviteCodeHandler";
import { endCoachClientRelationship } from "../../../relationships/endCoachClientRelationship";
import { trainersRespondToRequestHandler } from "../../../trainers/relationships/trainersRespondToRequestHandler";
import { trainersRespondToClientRequestHandler } from "../../../trainers/relationships/trainersRespondToClientRequestHandler";
import { currentDeclarationVersion } from "../../declaration";
import { closeFormsOnEnd, generateOnce } from "../generators";
import type { DbOrTx } from "../../../repositories/personalRecordsRepository";
import { repeatingFormHandler, starterFormHandler } from "../formSetupSections";

const MIGRATIONS = "../../../../../../../supabase/migrations/";
const ROLLBACKS = "../../../../../../../supabase/rollbacks/";
const read = (dir: string, file: string) =>
  readFile(new URL(`${dir}${file}`, import.meta.url), "utf8");
const A1 = "20261120120000_coaching_relationships_client_profiles.sql";
const MIGRATION = "20261120235941_coach_forms.sql";

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
  // PER-118: offboarding also sets this coach's meal-plan assignments to removed.
  schema.nutritionPlans,
  schema.nutritionPlanAssignments,
];

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

/** A database with design A applied, BEFORE this migration. */
async function baseDatabase(): Promise<PGlite> {
  const pg = await PGlite.create();
  await pg.exec(
    "create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';",
  );
  for (const table of BASE_TABLES) await pg.exec(ddl(table));
  await pg.exec(
    "alter table pt_client_relationships drop column activated_at, drop column client_profile_id;",
  );
  await pg.exec(
    await read(MIGRATIONS, "20260626110000_trainer_invite_codes.sql"),
  );
  await pg.exec(await read(MIGRATIONS, A1));
  return pg;
}

const COACH_A = randomUUID();
const COACH_B = randomUUID();
const COACH_D = randomUUID();
const ATHLETE_C = randomUUID();
const ATHLETE_E = randomUUID();
const ATHLETE_F = randomUUID();

const FORM_TABLES = [
  "coach_form_responses",
  "coach_form_requests",
  "coach_form_schedule_clients",
  "coach_form_schedules",
  "coach_form_versions",
  "coach_forms",
];
const TRUNCATE = [
  ...FORM_TABLES,
  "trainer_declarations",
  "coach_client_settings",
  "coach_client_setup_items",
  "trainer_invite_codes",
  "coach_client_profiles",
  ...BASE_TABLES.map((t) => getTableConfig(t).name),
];

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const realDb = () => db as unknown as DbOrTx;

const app = new Elysia()
  .use(coreErrorHandler)
  .use(coachingRoutes)
  .use(trainersAcceptInviteCodeHandler)
  .use(trainersRespondToRequestHandler)
  .use(trainersRespondToClientRequestHandler);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function http(
  method: string,
  path: string,
  actor: string | null,
  body?: unknown,
  key?: string,
): Promise<{ status: number; json: Json }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(actor ? { authorization: `Bearer ${actor}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const ALL_TYPES = [
  { id: "mood", type: "scale", prompt: "How was your week?", required: true },
  {
    id: "weight",
    type: "number",
    prompt: "Morning weight",
    min: 30,
    max: 300,
    unit: "kg",
  },
  { id: "wins", type: "short_text", prompt: "Wins this week" },
  { id: "notes", type: "long_text", prompt: "Anything else?" },
  {
    id: "sleep",
    type: "single_choice",
    prompt: "Sleep",
    options: ["Bad", "OK", "Good"],
  },
  {
    id: "areas",
    type: "multiple_choice",
    prompt: "What went well?",
    options: ["Diet", "Training", "Sleep"],
  },
  { id: "ill", type: "yes_no", prompt: "Were you ill?" },
  { id: "front", type: "photo", prompt: "Front photo" },
];

const SIMPLE = [
  { id: "q1", type: "short_text", prompt: "Goal?", required: true },
];

async function makeForm(
  coach: string,
  title = "Weekly check-in",
  questions: unknown[] = SIMPLE,
  key?: string,
) {
  const res = await http(
    "POST",
    "/trainers/me/forms",
    coach,
    { title, questions },
    key,
  );
  expect(res.status).toBe(201);
  return res.json.data as Json;
}

async function makeSchedule(coach: string, body: object, key?: string) {
  const res = await http(
    "POST",
    "/trainers/me/form-schedules",
    coach,
    body,
    key,
  );
  expect(res.status).toBe(201);
  return res.json.data as Json;
}

const pending = (athlete: string) =>
  http("GET", "/users/me/form-requests", athlete);

const answer = (
  athlete: string,
  requestId: string,
  answers: unknown,
  key?: string,
) =>
  http(
    "POST",
    `/users/me/form-requests/${requestId}/response`,
    athlete,
    { answers },
    key,
  );

const requestsFor = async (clientId: string) =>
  db
    .select()
    .from(schema.coachFormRequests)
    .where(eq(schema.coachFormRequests.clientId, clientId));

const relationship = async (trainerId: string, clientId: string) =>
  (
    await db
      .select()
      .from(schema.ptClientRelationships)
      .where(
        and(
          eq(schema.ptClientRelationships.trainerId, trainerId),
          eq(schema.ptClientRelationships.clientId, clientId),
        ),
      )
  )[0]!;

/** Coach A invites athlete F with a personal code; returns the code. */
async function personalInvite(setup: Record<string, unknown[]> = {}) {
  const profile = await http("POST", "/trainers/me/client-profiles", COACH_A, {
    displayName: "Frankie",
  });
  expect(profile.status).toBe(201);
  const id = profile.json.data.id;
  for (const [section, items] of Object.entries(setup)) {
    const res = await http(
      "PUT",
      `/trainers/me/client-profiles/${id}/setup/${section}`,
      COACH_A,
      { items },
    );
    expect([section, res.status, res.json]).toEqual([
      section,
      200,
      expect.anything(),
    ]);
  }
  const declared = await http("POST", "/trainers/me/declaration", COACH_A, {
    statementVersion: currentDeclarationVersion(),
  });
  expect(declared.status).toBe(200);
  const invite = await http(
    "POST",
    `/trainers/me/client-profiles/${id}/invite`,
    COACH_A,
  );
  expect(invite.status).toBe(201);
  return { profileId: id as string, code: invite.json.data.code as string };
}

const accept = (athlete: string, code: string) =>
  http("POST", "/trainers/accept-invite-code", athlete, {
    code,
    consent: true,
    consentVersion: "v1-2026-07",
  });

const end = (trainerId: string, clientId: string) =>
  endCoachClientRelationship({ trainerId, clientId, initiatedBy: "client" });

beforeAll(async () => {
  pg = await baseDatabase();
  await pg.exec(await read(MIGRATIONS, MIGRATION));
  // PER-117: accept, responses and sessions now write coach events.
  await pg.exec(
    "DO $$ BEGIN CREATE TYPE notification_type AS ENUM ('coach_brief'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  );
  await pg.exec(
    await read(MIGRATIONS, "20261123120117_coach_events_notifications.sql"),
  );
  db = drizzle(pg, { schema });
  holder.db = db;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(`truncate ${TRUNCATE.map((t) => `"${t}"`).join(",")} cascade`);
  await db.insert(schema.profiles).values([
    { id: COACH_A, fullName: "Ellie", role: "personal_trainer" },
    { id: COACH_B, fullName: "Marcus", role: "physiotherapist" },
    { id: COACH_D, fullName: "Dana", role: "personal_trainer" },
    { id: ATHLETE_C, fullName: "Chris", role: "user" },
    { id: ATHLETE_E, fullName: "Lena", role: "user" },
    { id: ATHLETE_F, fullName: "Frankie", role: "user" },
  ]);
  // A coaches C and E; B coaches C. D coaches nobody.
  await db.insert(schema.ptClientRelationships).values([
    { trainerId: COACH_A, clientId: ATHLETE_C, status: "active" },
    { trainerId: COACH_A, clientId: ATHLETE_E, status: "active" },
    { trainerId: COACH_B, clientId: ATHLETE_C, status: "active" },
  ]);
});

// ─── D7.1 Generator idempotency ──────────────────────────────────────────────

describe("D7.1 generator idempotency", () => {
  it("a replayed accept sends each starter form once, even when it is also an on_join rule", async () => {
    const starter = await makeForm(COACH_A, "Starter");
    const goals = await makeForm(COACH_A, "Goals");
    // Starter is both a set-up item AND an all-clients on_join rule.
    await makeSchedule(COACH_A, {
      formId: starter.id,
      trigger: "on_join",
      audience: "all_clients",
    });
    await makeSchedule(COACH_A, {
      formId: goals.id,
      trigger: "on_join",
      audience: "all_clients",
      dueAfterHours: 48,
    });
    const { code } = await personalInvite({
      starter_form: [{ refId: starter.id, config: {}, sortOrder: 0 }],
    });

    const first = await accept(ATHLETE_F, code);
    expect(first.status).toBe(201);
    expect(first.json.data.ready.forms).toEqual([{ title: "Starter" }]);
    const replay = await accept(ATHLETE_F, code);
    expect(replay.status).toBe(200);

    const rows = await requestsFor(ATHLETE_F);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.trigger === "on_join")).toBe(true);
    // Set-up order first, then the rules.
    const list = await pending(ATHLETE_F);
    expect(list.json.data.requests.map((r: Json) => r.title)).toEqual([
      "Goals",
      "Starter",
    ]);
    const goalsRow = rows.find((r) => r.formId === goals.id)!;
    expect(goalsRow.dueAt!.getTime() - goalsRow.sentAt.getTime()).toBe(
      48 * 3600 * 1000,
    );
  });

  it("racing accepts create one request per key", async () => {
    const starter = await makeForm(COACH_A, "Starter");
    await makeSchedule(COACH_A, {
      formId: starter.id,
      trigger: "on_join",
      audience: "all_clients",
    });
    const { code } = await personalInvite({
      starter_form: [{ refId: starter.id, config: {}, sortOrder: 0 }],
    });
    const results = await Promise.all([
      accept(ATHLETE_F, code),
      accept(ATHLETE_F, code),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await requestsFor(ATHLETE_F)).toHaveLength(1);
  });

  it("overlapping once runs and a replayed schedule create make one request per client", async () => {
    const form = await makeForm(COACH_A);
    const body = {
      formId: form.id,
      trigger: "once",
      audience: "all_clients",
    };
    const s1 = await makeSchedule(COACH_A, body, "sched-key-1");
    const s2 = await makeSchedule(COACH_A, body, "sched-key-1");
    expect(s2.id).toBe(s1.id);
    const schedule = (
      await db
        .select()
        .from(schema.coachFormSchedules)
        .where(eq(schema.coachFormSchedules.id, s1.id))
    )[0]!;
    await Promise.all([
      db.transaction((tx) => generateOnce(tx as unknown as DbOrTx, schedule)),
      db.transaction((tx) => generateOnce(tx as unknown as DbOrTx, schedule)),
      generateOnce(realDb(), schedule),
    ]);
    const rows = await db.select().from(schema.coachFormRequests);
    expect(rows.map((r) => r.clientId).sort()).toEqual(
      [ATHLETE_C, ATHLETE_E].sort(),
    );
    expect(await db.select().from(schema.coachFormSchedules)).toHaveLength(1);
  });

  it("re-running offboarding sends one exit form", async () => {
    const exit = await makeForm(COACH_A, "Exit");
    await makeSchedule(COACH_A, {
      formId: exit.id,
      trigger: "on_end",
      audience: "all_clients",
    });
    const ended = await end(COACH_A, ATHLETE_C);
    expect(ended.ok).toBe(true);
    expect(await end(COACH_A, ATHLETE_C)).toEqual({ ok: false, status: 404 });
    const rel = await relationship(COACH_A, ATHLETE_C);
    const again = await db.transaction((tx) =>
      closeFormsOnEnd(tx as unknown as DbOrTx, {
        trainerId: COACH_A,
        clientId: ATHLETE_C,
        relationshipId: rel.id,
      }),
    );
    expect(again.exitRequestIds).toEqual([]);
    const rows = await requestsFor(ATHLETE_C);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trigger: "on_end", status: "pending" });
  });

  it("a revived relationship is a new cycle: the next join sends again", async () => {
    const starter = await makeForm(COACH_A, "Starter");
    await makeSchedule(COACH_A, {
      formId: starter.id,
      trigger: "on_join",
      audience: "all_clients",
    });
    const first = await personalInvite();
    expect((await accept(ATHLETE_F, first.code)).status).toBe(201);
    expect((await end(COACH_A, ATHLETE_F)).ok).toBe(true);
    const second = await personalInvite();
    expect((await accept(ATHLETE_F, second.code)).status).toBe(201);
    const joins = (await requestsFor(ATHLETE_F)).filter(
      (r) => r.trigger === "on_join",
    );
    expect(joins).toHaveLength(2);
    expect(new Set(joins.map((r) => r.periodKey)).size).toBe(2);
    expect(joins.map((r) => r.status).sort()).toEqual(["cancelled", "pending"]);
  });
});

// ─── D7.4 Versioning ─────────────────────────────────────────────────────────

describe("D7.4 versioning", () => {
  it("editing after a send keeps the old questions on the old request and its response", async () => {
    const form = await makeForm(COACH_A, "Check-in", [
      { id: "q1", type: "short_text", prompt: "Old question", required: true },
    ]);
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    const edited = await http(
      "PATCH",
      `/trainers/me/forms/${form.id}`,
      COACH_A,
      {
        questions: [
          { id: "q2", type: "yes_no", prompt: "New question", required: true },
        ],
        expectedRevision: form.revision,
      },
    );
    expect(edited.status).toBe(200);
    expect(edited.json.data.version.version).toBe(2);
    expect(edited.json.data.revision).toBe(2);

    // The athlete still sees, and answers, version 1.
    const list = await pending(ATHLETE_C);
    const req = list.json.data.requests[0];
    expect(req.version.version).toBe(1);
    expect(req.version.questions[0].prompt).toBe("Old question");
    expect((await answer(ATHLETE_C, req.id, { q2: true })).json.code).toBe(
      "invalid_answers",
    );
    const done = await answer(ATHLETE_C, req.id, { q1: "Run 10k" });
    expect(done.status).toBe(201);

    // The coach's history shows that response with ITS questions.
    const history = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/form-responses`,
      COACH_A,
    );
    expect(history.json.data[0]).toMatchObject({
      answers: { q1: "Run 10k" },
      version: { version: 1, questions: [{ id: "q1" }] },
    });

    // A new send uses version 2; the old one is still readable.
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    const next = await pending(ATHLETE_C);
    expect(next.json.data.requests[0].version.version).toBe(2);
    const v1 = await http(
      "GET",
      `/trainers/me/forms/${form.id}?version=1`,
      COACH_A,
    );
    expect(v1.json.data.version.questions[0].id).toBe("q1");
    expect(
      (await http("GET", `/trainers/me/forms/${form.id}?version=9`, COACH_A))
        .status,
    ).toBe(404);
  });

  it("unchanged questions make no new version; versions can't be updated in the database", async () => {
    const form = await makeForm(COACH_A);
    const same = await http("PATCH", `/trainers/me/forms/${form.id}`, COACH_A, {
      title: "Renamed",
      questions: SIMPLE,
    });
    expect(same.json.data).toMatchObject({
      title: "Renamed",
      version: { version: 1 },
    });
    await expect(
      pg.exec(
        `update coach_form_versions set questions = '[]' where form_id = '${form.id}'`,
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("a stale expectedRevision is a 409 with the current form", async () => {
    const form = await makeForm(COACH_A);
    await http("PATCH", `/trainers/me/forms/${form.id}`, COACH_A, {
      title: "Phone edit",
    });
    const stale = await http(
      "PATCH",
      `/trainers/me/forms/${form.id}`,
      COACH_A,
      {
        title: "Web edit",
        expectedRevision: 1,
      },
    );
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({
      code: "revision_conflict",
      current: { title: "Phone edit", revision: 2 },
    });
  });
});

// ─── D7.5 Scoping ────────────────────────────────────────────────────────────

describe("D7.5 scoping (two coaches, one athlete)", () => {
  it("coach B can't list, read, edit, archive or schedule coach A's forms", async () => {
    const form = await makeForm(COACH_A);
    const schedule = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "weekly",
      audience: "selected",
      clientIds: [ATHLETE_C],
      weekday: 7,
      timeLocal: "18:00",
    });
    expect(
      (await http("GET", "/trainers/me/forms", COACH_B)).json.data.forms,
    ).toEqual([]);
    expect(
      (await http("GET", `/trainers/me/forms/${form.id}`, COACH_B)).status,
    ).toBe(404);
    expect(
      (
        await http("PATCH", `/trainers/me/forms/${form.id}`, COACH_B, {
          title: "Mine now",
        })
      ).status,
    ).toBe(404);
    expect(
      (await http("DELETE", `/trainers/me/forms/${form.id}`, COACH_B)).status,
    ).toBe(204);
    const b = await http("POST", "/trainers/me/form-schedules", COACH_B, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    expect(b.status).toBe(404);
    expect(
      (await http("GET", "/trainers/me/form-schedules", COACH_B)).json.data
        .schedules,
    ).toEqual([]);
    expect(
      (
        await http(
          "PATCH",
          `/trainers/me/form-schedules/${schedule.id}`,
          COACH_B,
          {
            status: "paused",
          },
        )
      ).status,
    ).toBe(404);
    await http("DELETE", `/trainers/me/form-schedules/${schedule.id}`, COACH_B);
    expect(
      (
        await http(
          "PUT",
          `/trainers/me/clients/${ATHLETE_C}/forms/${form.id}/setup`,
          COACH_B,
          { status: "paused" },
        )
      ).status,
    ).toBe(404);
    // A's form and rule are untouched.
    const mine = await http("GET", `/trainers/me/forms/${form.id}`, COACH_A);
    expect(mine.json.data).toMatchObject({ archivedAt: null, revision: 1 });
    expect(
      (await http("GET", "/trainers/me/form-schedules", COACH_A)).json.data
        .schedules[0].status,
    ).toBe("active");
  });

  it("coach B never sees or reviews coach A's requests and responses for the shared athlete", async () => {
    const form = await makeForm(COACH_A);
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    const req = (await pending(ATHLETE_C)).json.data.requests[0];
    const done = await answer(ATHLETE_C, req.id, { q1: "Get strong" });
    const responseId = done.json.data.id;

    const tab = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/forms`,
      COACH_B,
    );
    expect(tab.status).toBe(200);
    expect(tab.json.data).toEqual([]);
    const history = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/form-responses`,
      COACH_B,
    );
    expect(history.json.data).toEqual([]);
    const review = await http(
      "POST",
      `/trainers/me/clients/${ATHLETE_C}/form-responses/${responseId}/review`,
      COACH_B,
      { replyText: "Nice" },
    );
    expect(review.status).toBe(404);
    // A coach with no relationship, a non-coach and an anonymous caller.
    for (const actor of [COACH_D, ATHLETE_E]) {
      const res = await http(
        "GET",
        `/trainers/me/clients/${ATHLETE_C}/form-responses`,
        actor,
      );
      expect(res.status).toBe(403);
    }
    expect((await http("GET", "/trainers/me/forms", ATHLETE_E)).status).toBe(
      403,
    );
    expect((await http("GET", "/trainers/me/forms", null)).status).toBe(401);
    // A still sees it, unreviewed.
    const mine = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/form-responses`,
      COACH_A,
    );
    expect(mine.json.data).toHaveLength(1);
    expect(mine.json.data[0].reviewedAt).toBeNull();
  });

  it("an athlete can't see or answer another athlete's request", async () => {
    const form = await makeForm(COACH_A);
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    const req = (await pending(ATHLETE_C)).json.data.requests[0];
    expect((await pending(ATHLETE_E)).json.data.requests).toEqual([]);
    const res = await answer(ATHLETE_E, req.id, { q1: "Hijack" });
    expect(res.status).toBe(404);
    expect(await db.select().from(schema.coachFormResponses)).toEqual([]);
  });

  it("a schedule can't target someone who isn't the coach's active client", async () => {
    const form = await makeForm(COACH_B);
    const res = await http("POST", "/trainers/me/form-schedules", COACH_B, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C, ATHLETE_E],
    });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({
      code: "not_your_client",
      clientIds: [ATHLETE_E],
    });
  });
});

// ─── D7.6 Answers ────────────────────────────────────────────────────────────

describe("D7.6 answers", () => {
  async function sendAll(questions: unknown[] = ALL_TYPES) {
    const form = await makeForm(COACH_A, "All types", questions);
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
      dueAfterHours: 24,
    });
    const list = (await pending(ATHLETE_C)).json.data.requests as Json[];
    return list.find((r) => r.formId === form.id);
  }

  it("accepts every question type and stores the normalised answers", async () => {
    const req = await sendAll();
    expect(req).toMatchObject({
      status: "pending",
      late: false,
      coach: { id: COACH_A, name: "Ellie" },
      title: "All types",
    });
    const res = await answer(
      ATHLETE_C,
      req.id,
      {
        mood: 4,
        weight: 82.5,
        wins: "  Hit a PR ",
        notes: "Slept badly",
        sleep: "OK",
        areas: ["Sleep", "Diet", "Sleep"],
        ill: false,
      },
      "resp-key-1",
    );
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({
      late: false,
      answers: {
        mood: 4,
        weight: 82.5,
        wins: "Hit a PR",
        notes: "Slept badly",
        sleep: "OK",
        areas: ["Diet", "Sleep"],
        ill: false,
      },
    });
    // The request is done and leaves the due list.
    expect((await pending(ATHLETE_C)).json.data.requests).toEqual([]);
  });

  it("rejects wrong values per type, missing required answers and unknown questions", async () => {
    const req = await sendAll();
    const res = await answer(ATHLETE_C, req.id, {
      weight: 10,
      wins: 7,
      notes: "x".repeat(5001),
      sleep: "Great",
      areas: ["Nope"],
      ill: "yes",
      bogus: 1,
    });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("invalid_answers");
    expect(res.json.errors.map((e: Json) => e.at).sort()).toEqual(
      [
        "areas",
        "bogus",
        "ill",
        "mood",
        "notes",
        "sleep",
        "weight",
        "wins",
      ].sort(),
    );
    expect(
      (await answer(ATHLETE_C, req.id, { mood: 6 })).json.errors[0],
    ).toMatchObject({ at: "mood" });
    expect((await answer(ATHLETE_C, req.id, "nope")).status).toBe(422);
  });

  it("photo questions can be created but answering one is a 422 until BE-F1", async () => {
    const req = await sendAll();
    const optionalPhoto = await answer(ATHLETE_C, req.id, {
      mood: 3,
      front: { mediaId: randomUUID() },
    });
    expect(optionalPhoto.status).toBe(422);
    expect(optionalPhoto.json.code).toBe("photo_unavailable");
    // A form with a REQUIRED photo can't be submitted at all yet.
    const required = await sendAll([
      { id: "front", type: "photo", prompt: "Front", required: true },
    ]);
    const res = await answer(ATHLETE_C, required.id, {});
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("photo_unavailable");
  });

  it("a missed request can be answered late for 7 days, then it's closed", async () => {
    const req = await sendAll();
    // Due yesterday: shown as missed, still answerable.
    await pg.exec(
      `update coach_form_requests set sent_at = now() - interval '3 days', due_at = now() - interval '1 day' where id = '${req.id}'`,
    );
    const list = await http(
      "GET",
      "/users/me/form-requests?status=missed",
      ATHLETE_C,
    );
    expect(list.json.data.requests[0]).toMatchObject({
      status: "missed",
      late: true,
    });
    expect(
      (await http("GET", "/users/me/form-requests?status=pending", ATHLETE_C))
        .json.data.requests,
    ).toEqual([]);
    const late = await answer(ATHLETE_C, req.id, { mood: 2 });
    expect(late.status).toBe(201);
    expect(late.json.data.late).toBe(true);

    // Stored as missed by the scheduler, due 8 days ago: closed.
    const old = await sendAll();
    await pg.exec(
      `update coach_form_requests set status = 'missed', due_at = now() - interval '8 days' where id = '${old.id}'`,
    );
    expect((await pending(ATHLETE_C)).json.data.requests).toEqual([]);
    const closed = await answer(ATHLETE_C, old.id, { mood: 2 });
    expect(closed.status).toBe(409);
    expect(closed.json).toMatchObject({
      code: "request_closed",
      reason: "expired",
    });
  });

  it("Idempotency-Key replays return the stored response; other resubmits are 409", async () => {
    const req = await sendAll();
    const first = await answer(ATHLETE_C, req.id, { mood: 5 }, "k-1");
    const replay = await answer(ATHLETE_C, req.id, { mood: 1 }, "k-1");
    expect(replay.status).toBe(201);
    expect(replay.json.data).toEqual(first.json.data);
    const again = await answer(ATHLETE_C, req.id, { mood: 1 }, "k-2");
    expect(again.status).toBe(409);
    expect(again.json.reason).toBe("completed");
    expect(await db.select().from(schema.coachFormResponses)).toHaveLength(1);
    expect((await answer(ATHLETE_C, randomUUID(), { mood: 1 })).status).toBe(
      404,
    );
  });

  it("a cancelled request is 409 request_closed", async () => {
    const req = await sendAll();
    await pg.exec(
      `update coach_form_requests set status = 'cancelled' where id = '${req.id}'`,
    );
    const res = await answer(ATHLETE_C, req.id, { mood: 3 });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({
      code: "request_closed",
      reason: "cancelled",
      message: "This check-in is no longer needed",
    });
  });
});

// ─── D7.8 Exit form ──────────────────────────────────────────────────────────

describe("D7.8 exit form", () => {
  it("is generated on ending, answerable after, and visible to that coach only", async () => {
    const weekly = await makeForm(COACH_A, "Weekly");
    const exit = await makeForm(COACH_A, "Exit survey");
    const weeklyRule = await makeSchedule(COACH_A, {
      formId: weekly.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    await makeSchedule(COACH_A, {
      formId: exit.id,
      trigger: "on_end",
      audience: "all_clients",
      dueAfterHours: 72,
    });
    // B also coaches C, with an exit form of their own.
    const bExit = await makeForm(COACH_B, "B exit");
    await makeSchedule(COACH_B, {
      formId: bExit.id,
      trigger: "on_end",
      audience: "all_clients",
    });
    // Before the end: one answered, one still pending.
    const req = (await pending(ATHLETE_C)).json.data.requests[0];
    await answer(ATHLETE_C, req.id, { q1: "Done" });
    await makeSchedule(COACH_A, {
      formId: weekly.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });

    expect((await end(COACH_A, ATHLETE_C)).ok).toBe(true);

    const rows = await requestsFor(ATHLETE_C);
    expect(
      rows.filter((r) => r.status === "pending").map((r) => r.trigger),
    ).toEqual(["on_end"]);
    expect(rows.filter((r) => r.status === "cancelled")).toHaveLength(1);
    expect(rows.find((r) => r.trigger === "on_end")!.trainerId).toBe(COACH_A);
    const targets = await db
      .select()
      .from(schema.coachFormScheduleClients)
      .where(eq(schema.coachFormScheduleClients.scheduleId, weeklyRule.id));
    // The targets are removed, so a rejoin starts from the rules as they are.
    expect(targets).toEqual([]);

    // The athlete answers it after coaching has ended.
    const due = (await pending(ATHLETE_C)).json.data.requests;
    expect(due.map((r: Json) => r.title)).toEqual(["Exit survey"]);
    const exitAnswer = await answer(ATHLETE_C, due[0].id, { q1: "Thanks" });
    expect(exitAnswer.status).toBe(201);

    // Coach A sees the exit response, and nothing else.
    const history = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/form-responses`,
      COACH_A,
    );
    expect(history.status).toBe(200);
    expect(history.json.data.map((r: Json) => r.title)).toEqual([
      "Exit survey",
    ]);
    const reviewed = await http(
      "POST",
      `/trainers/me/clients/${ATHLETE_C}/form-responses/${exitAnswer.json.data.id}/review`,
      COACH_A,
      { replyText: "Good luck!" },
    );
    expect(reviewed.json.data).toMatchObject({ replyText: "Good luck!" });
    expect(
      (
        await http(
          "POST",
          `/trainers/me/clients/${ATHLETE_C}/form-responses/${req.id}/review`,
          COACH_A,
        )
      ).status,
    ).toBe(404);
    // The Check-ins tab and set-up need an active relationship.
    for (const [method, path, body] of [
      ["GET", `/trainers/me/clients/${ATHLETE_C}/forms`],
      [
        "PUT",
        `/trainers/me/clients/${ATHLETE_C}/forms/${weekly.id}/setup`,
        { status: "active" },
      ],
    ] as [string, string, unknown?][]) {
      expect((await http(method, path, COACH_A, body)).status).toBe(403);
    }
    // Coach B (still coaching C) sees none of A's forms; B's exit form wasn't sent.
    const b = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/form-responses`,
      COACH_B,
    );
    expect(b.json.data).toEqual([]);
    expect(rows.some((r) => r.trainerId === COACH_B)).toBe(false);
  });

  it("a client paused or excluded from the exit rule gets no exit form", async () => {
    const exit = await makeForm(COACH_A, "Exit");
    await makeSchedule(COACH_A, {
      formId: exit.id,
      trigger: "on_end",
      audience: "all_clients",
    });
    const setup = await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${exit.id}/setup`,
      COACH_A,
      { status: "excluded" },
    );
    expect(setup.status).toBe(200);
    await end(COACH_A, ATHLETE_C);
    expect(await requestsFor(ATHLETE_C)).toEqual([]);
  });
});

// ─── D7.10 Migration ─────────────────────────────────────────────────────────

describe("D7.10 migration", () => {
  it("applies twice, rolls back and re-applies, with RLS on and no templates", async () => {
    const fresh = await baseDatabase();
    try {
      const sql = await read(MIGRATIONS, MIGRATION);
      await fresh.exec(sql);
      await fresh.exec(sql);
      await fresh.exec(await read(ROLLBACKS, MIGRATION));
      const gone = await fresh.query<{ n: number }>(
        "select count(*)::int as n from pg_tables where tablename like 'coach_form%'",
      );
      expect(gone.rows[0]!.n).toBe(0);
      await fresh.exec(sql);
      const tables = await fresh.query<{ tablename: string; rls: boolean }>(
        "select tablename, rowsecurity as rls from pg_tables where tablename like 'coach_form%' order by 1",
      );
      expect(tables.rows).toEqual(
        [
          "coach_form_requests",
          "coach_form_responses",
          "coach_form_schedule_clients",
          "coach_form_schedules",
          "coach_form_versions",
          "coach_forms",
        ].map((tablename) => ({ tablename, rls: true })),
      );
      const policies = await fresh.query<{ n: number }>(
        "select count(*)::int as n from pg_policies where tablename like 'coach_form%'",
      );
      expect(policies.rows[0]!.n).toBe(0);
      const templates = await fresh.query<{ n: number }>(
        "select count(*)::int as n from coach_forms",
      );
      expect(templates.rows[0]!.n).toBe(0);
      const uq = await fresh.query<{ indexdef: string }>(
        "select indexdef from pg_indexes where indexname = 'coach_form_requests_period_uq'",
      );
      expect(uq.rows[0]!.indexdef).toMatch(
        /UNIQUE INDEX .* \(relationship_id, form_id, trigger, period_key\)/,
      );
      // An owner or a template key, never both, never neither.
      await expect(
        fresh.exec("insert into coach_forms (title) values ('x')"),
      ).rejects.toThrow(/coach_forms_owner_or_template_ck/);
    } finally {
      await fresh.close();
    }
  });

  it("templates: none ship, and one added later as data can be copied", async () => {
    const empty = await http(
      "GET",
      "/trainers/me/forms?include=templates",
      COACH_A,
    );
    expect(empty.json.data).toMatchObject({ forms: [], templates: [] });
    expect(
      (
        await http("POST", "/trainers/me/forms", COACH_A, {
          fromTemplateKey: "par_q",
        })
      ).status,
    ).toBe(404);

    // The later data migration: INSERT … ON CONFLICT (template_key).
    await pg.exec(`
      insert into coach_forms (template_key, title, description)
      values ('par_q', 'PAR-Q', 'Health screening')
      on conflict (template_key) do nothing;
      insert into coach_form_versions (form_id, version, questions)
      select id, 1, '[{"id":"heart","type":"yes_no","prompt":"Heart condition?","required":true}]'::jsonb
        from coach_forms where template_key = 'par_q'
      on conflict (form_id, version) do nothing;
      update coach_forms f set current_version_id = v.id
        from coach_form_versions v
       where v.form_id = f.id and f.template_key = 'par_q';
    `);
    const listed = await http(
      "GET",
      "/trainers/me/forms?include=templates",
      COACH_A,
    );
    expect(listed.json.data.templates).toHaveLength(1);
    expect(listed.json.data.templates[0]).toMatchObject({
      templateKey: "par_q",
      version: { questions: [{ id: "heart" }] },
    });
    const copy = await http("POST", "/trainers/me/forms", COACH_A, {
      fromTemplateKey: "par_q",
    });
    expect(copy.status).toBe(201);
    expect(copy.json.data).toMatchObject({
      title: "PAR-Q",
      description: "Health screening",
      templateKey: null,
      version: { version: 1, questions: [{ id: "heart" }] },
    });
    // A coach reads a template, but can't edit it.
    const templateId = listed.json.data.templates[0].id;
    expect(
      (await http("GET", `/trainers/me/forms/${templateId}`, COACH_A)).status,
    ).toBe(200);
    expect(
      (
        await http("PATCH", `/trainers/me/forms/${templateId}`, COACH_A, {
          title: "Mine",
        })
      ).status,
    ).toBe(404);
  });
});

// ─── Library, rules, set-up, Check-ins tab ───────────────────────────────────

describe("forms library", () => {
  it("creates idempotently, lists changes since, and archives idempotently", async () => {
    const a = await makeForm(COACH_A, "  Intake ", SIMPLE, "form-key");
    const replay = await makeForm(COACH_A, "Different", SIMPLE, "form-key");
    expect(replay.id).toBe(a.id);
    expect(a.title).toBe("Intake");
    const list = await http("GET", "/trainers/me/forms", COACH_A);
    expect(list.json.data.forms.map((f: Json) => f.id)).toEqual([a.id]);
    expect(list.json.data.templates).toBeUndefined();
    const asOf = list.json.data.asOf;
    expect(new Date(asOf).getTime()).toBeLessThan(Date.now());

    await new Promise((r) => setTimeout(r, 5));
    const since = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    const b = await makeForm(COACH_A, "Weekly");
    expect(
      (await http("DELETE", `/trainers/me/forms/${a.id}`, COACH_A)).status,
    ).toBe(204);
    expect(
      (await http("DELETE", `/trainers/me/forms/${a.id}`, COACH_A)).status,
    ).toBe(204);
    expect(
      (await http("DELETE", `/trainers/me/forms/${randomUUID()}`, COACH_A))
        .status,
    ).toBe(204);
    const changes = await http(
      "GET",
      `/trainers/me/forms?since=${encodeURIComponent(since)}`,
      COACH_A,
    );
    expect(changes.json.data.forms.map((f: Json) => f.id)).toEqual([b.id]);
    expect(changes.json.data.deletedIds).toEqual([a.id]);
    expect(
      (await http("GET", "/trainers/me/forms?since=garbage", COACH_A)).status,
    ).toBe(400);
    // Archived forms stay readable (history) but can't be edited.
    expect(
      (await http("GET", `/trainers/me/forms/${a.id}`, COACH_A)).json.data
        .archivedAt,
    ).not.toBeNull();
    expect(
      (
        await http("PATCH", `/trainers/me/forms/${a.id}`, COACH_A, {
          title: "x",
        })
      ).status,
    ).toBe(404);
  });

  it("validates title and questions", async () => {
    const bad = async (body: object) =>
      http("POST", "/trainers/me/forms", COACH_A, body);
    expect((await bad({ title: " ", questions: SIMPLE })).json.code).toBe(
      "invalid_form",
    );
    const res = await bad({
      title: "T",
      questions: [
        { id: "a", type: "single_choice", prompt: "P", options: ["one"] },
        { id: "a", type: "short_text", prompt: "P" },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("invalid_questions");
    expect((await bad({ title: "T", questions: [] })).status).toBe(422);
    const form = await makeForm(COACH_A);
    const patch = async (body: object) =>
      http("PATCH", `/trainers/me/forms/${form.id}`, COACH_A, body);
    expect((await patch({ title: "" })).json.code).toBe("invalid_form");
    expect((await patch({ questions: [{}] })).json.code).toBe(
      "invalid_questions",
    );
    expect((await patch({ description: "  " })).json.data.description).toBe(
      null,
    );
    expect(
      (await http("PATCH", `/trainers/me/forms/${randomUUID()}`, COACH_A, {}))
        .status,
    ).toBe(404);
  });
});

describe("send rules", () => {
  it("validates rules against their trigger", async () => {
    const form = await makeForm(COACH_A);
    const post = (body: object) =>
      http("POST", "/trainers/me/form-schedules", COACH_A, {
        formId: form.id,
        ...body,
      });
    const cases: [object, RegExp][] = [
      [{ trigger: "weekly", audience: "all_clients" }, /weekday and timeLocal/],
      [{ trigger: "daily", audience: "all_clients" }, /daily rules need/],
      [
        { trigger: "once", audience: "all_clients", weekday: 1 },
        /weekly rules only/,
      ],
      [
        { trigger: "once", audience: "all_clients", timeLocal: "09:00" },
        /weekly or daily/,
      ],
      [
        {
          trigger: "weekly",
          audience: "all_clients",
          weekday: 8,
          timeLocal: "09:00",
        },
        /weekday must be/,
      ],
      [
        { trigger: "daily", audience: "all_clients", timeLocal: "25:00" },
        /HH:MM/,
      ],
      [
        { trigger: "once", audience: "all_clients", dueAfterHours: 0 },
        /dueAfterHours/,
      ],
      [
        {
          trigger: "once",
          audience: "all_clients",
          reminders: Array.from({ length: 6 }, (_, i) => ({
            afterHours: i + 1,
          })),
        },
        /at most 5/,
      ],
      [
        {
          trigger: "once",
          audience: "all_clients",
          reminders: [{ afterHours: 0 }],
        },
        /reminder afterHours/,
      ],
      [
        { trigger: "on_join", audience: "selected", clientIds: [ATHLETE_C] },
        /every new client/,
      ],
      [
        { trigger: "once", audience: "all_clients", clientIds: [ATHLETE_C] },
        /only for the selected/,
      ],
      [{ trigger: "once", audience: "selected" }, /selected needs/],
    ];
    for (const [body, message] of cases) {
      const res = await post(body);
      expect([JSON.stringify(body), res.status]).toEqual([
        JSON.stringify(body),
        422,
      ]);
      expect(res.json.message).toMatch(message);
    }
    const ok = await post({
      trigger: "weekly",
      audience: "selected",
      clientIds: [ATHLETE_C, ATHLETE_C],
      weekday: 7,
      timeLocal: "18:00:00",
      dueAfterHours: 24,
      reminders: [{ afterHours: 12 }, { afterHours: 2 }, { afterHours: 12 }],
    });
    expect(ok.status).toBe(201);
    expect(ok.json.data).toMatchObject({
      weekday: 7,
      timeLocal: "18:00",
      reminders: [{ afterHours: 2 }, { afterHours: 12 }],
      clients: [{ clientId: ATHLETE_C, status: "active" }],
    });
    // Weekly periods are BE-C2's: nothing is sent yet.
    expect(await requestsFor(ATHLETE_C)).toEqual([]);
    const archived = await makeForm(COACH_A, "Old");
    await http("DELETE", `/trainers/me/forms/${archived.id}`, COACH_A);
    expect(
      (
        await http("POST", "/trainers/me/form-schedules", COACH_A, {
          formId: archived.id,
          trigger: "once",
          audience: "all_clients",
        })
      ).json.code,
    ).toBe("form_not_found");
  });

  it("adds, removes, pauses and stops: once sends to new targets, stop cancels pending", async () => {
    const form = await makeForm(COACH_A);
    const s = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
      status: "paused",
    });
    expect(await requestsFor(ATHLETE_C)).toEqual([]);
    const patch = (body: object) =>
      http("PATCH", `/trainers/me/form-schedules/${s.id}`, COACH_A, body);
    // Resume: sends to C.
    expect((await patch({ status: "active" })).status).toBe(200);
    expect(await requestsFor(ATHLETE_C)).toHaveLength(1);
    // Swap C for E: C's pending request is cancelled, E gets one.
    const swapped = await patch({ clientIds: [ATHLETE_E] });
    expect(swapped.json.data.clients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientId: ATHLETE_C, status: "excluded" }),
        expect.objectContaining({ clientId: ATHLETE_E, status: "active" }),
      ]),
    );
    expect((await requestsFor(ATHLETE_C))[0]!.status).toBe("cancelled");
    expect(await requestsFor(ATHLETE_E)).toHaveLength(1);
    // Bring C back: the cancelled request is sent again (same row).
    await patch({ clientIds: [ATHLETE_C, ATHLETE_E] });
    const cAgain = await requestsFor(ATHLETE_C);
    expect(cAgain.map((r) => r.status)).toEqual(["pending"]);
    expect((await patch({ clientIds: [ATHLETE_D_NOT_CLIENT] })).status).toBe(
      422,
    );
    expect((await patch({ weekday: 3 })).status).toBe(422);
    expect(
      (await patch({ audience: "all_clients", clientIds: [ATHLETE_C] })).status,
    ).toBe(422);
    expect((await patch({ clientIds: [] })).status).toBe(422);
    const stale = await patch({ dueAfterHours: 5, expectedRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("revision_conflict");
    // Stop cancels everything pending; a stopped rule is final.
    expect(
      (await http("DELETE", `/trainers/me/form-schedules/${s.id}`, COACH_A))
        .status,
    ).toBe(204);
    expect(
      (await http("DELETE", `/trainers/me/form-schedules/${s.id}`, COACH_A))
        .status,
    ).toBe(204);
    expect((await requestsFor(ATHLETE_E))[0]!.status).toBe("cancelled");
    expect((await patch({ status: "active" })).json.code).toBe(
      "schedule_stopped",
    );
    expect(
      (
        await http(
          "PATCH",
          `/trainers/me/form-schedules/${randomUUID()}`,
          COACH_A,
          {},
        )
      ).status,
    ).toBe(404);
  });

  it("an on_join rule can't be narrowed to selected; patch keeps unspecified fields", async () => {
    const form = await makeForm(COACH_A);
    const s = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "daily",
      audience: "all_clients",
      timeLocal: "07:30",
    });
    const res = await http(
      "PATCH",
      `/trainers/me/form-schedules/${s.id}`,
      COACH_A,
      { reminders: [{ afterHours: 3 }], expectedRevision: s.revision },
    );
    expect(res.json.data).toMatchObject({
      timeLocal: "07:30",
      reminders: [{ afterHours: 3 }],
      revision: 2,
    });
    const j = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "on_join",
      audience: "all_clients",
    });
    expect(
      (
        await http("PATCH", `/trainers/me/form-schedules/${j.id}`, COACH_A, {
          audience: "selected",
          clientIds: [ATHLETE_C],
        })
      ).status,
    ).toBe(422);
  });
});

const ATHLETE_D_NOT_CLIENT = randomUUID();

describe("per-client setup and the Check-ins tab (C3.3, C10j)", () => {
  it("shows each form with its rule, last done and state; pause, exclude and resume per client", async () => {
    const weekly = await makeForm(COACH_A, "Weekly check-in");
    const once = await makeForm(COACH_A, "Goals");
    const w = await makeSchedule(COACH_A, {
      formId: weekly.id,
      trigger: "weekly",
      audience: "all_clients",
      weekday: 7,
      timeLocal: "18:00",
    });
    await makeSchedule(COACH_A, {
      formId: once.id,
      trigger: "once",
      audience: "all_clients",
    });
    const tab = async () =>
      (await http("GET", `/trainers/me/clients/${ATHLETE_C}/forms`, COACH_A))
        .json.data as Json[];
    let forms = await tab();
    expect(forms).toHaveLength(2);
    const goals = forms.find((f) => f.form.title === "Goals");
    expect(goals).toMatchObject({ state: "notDoneYet", lastDoneAt: null });
    expect(goals.pendingRequestId).toBeTruthy();
    expect(forms.find((f) => f.form.title === "Weekly check-in")).toMatchObject(
      { state: "notDoneYet", rule: { trigger: "weekly", weekday: 7 } },
    );

    await answer(ATHLETE_C, goals.pendingRequestId, { q1: "Squat 100" });
    forms = await tab();
    expect(forms.find((f) => f.form.title === "Goals")).toMatchObject({
      state: "done",
      pendingRequestId: null,
    });

    // Pause the weekly check-in for C only, with a different time.
    const paused = await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${weekly.id}/setup`,
      COACH_A,
      { status: "paused", override: { timeLocal: "08:00" } },
    );
    expect(paused.status).toBe(200);
    expect(paused.json.data).toMatchObject({
      state: "paused",
      rule: { clientStatus: "paused", override: { timeLocal: "08:00" } },
    });
    // E is unaffected.
    const e = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_E}/forms`,
      COACH_A,
    );
    expect(e.json.data.find((f: Json) => f.form.id === weekly.id).state).toBe(
      "notDoneYet",
    );
    // Excluding drops the form from C's tab; an invalid override is a 422.
    const bad = await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${weekly.id}/setup`,
      COACH_A,
      { status: "active", override: { weekday: 9 } },
    );
    expect(bad.status).toBe(422);
    const excluded = await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${weekly.id}/setup`,
      COACH_A,
      { status: "excluded", scheduleId: w.id, override: null },
    );
    expect(excluded.json.data).toBeNull();
    expect((await tab()).map((f) => f.form.title)).toEqual(["Goals"]);
    // No live rule for the form → 404.
    const lone = await makeForm(COACH_A, "Lone");
    expect(
      (
        await http(
          "PUT",
          `/trainers/me/clients/${ATHLETE_C}/forms/${lone.id}/setup`,
          COACH_A,
          { status: "active" },
        )
      ).json.code,
    ).toBe("schedule_not_found");
  });

  it("resuming a once rule for a client who was excluded sends it", async () => {
    const form = await makeForm(COACH_A);
    const s = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_E],
    });
    const res = await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${form.id}/setup`,
      COACH_A,
      { status: "active", override: { dueAfterHours: 6 } },
    );
    expect(res.status).toBe(200);
    const [row] = await requestsFor(ATHLETE_C);
    expect(row).toMatchObject({ scheduleId: s.id, trigger: "once" });
    expect(row!.dueAt!.getTime() - row!.sentAt.getTime()).toBe(6 * 3600_000);
  });
});

describe("responses history and review", () => {
  it("pages newest first, filters by form, and review is idempotent", async () => {
    const form = await makeForm(COACH_A, "Weekly");
    const other = await makeForm(COACH_A, "Other");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      await makeSchedule(COACH_A, {
        formId: form.id,
        trigger: "once",
        audience: "selected",
        clientIds: [ATHLETE_C],
      });
    }
    await makeSchedule(COACH_A, {
      formId: other.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    for (const r of (await pending(ATHLETE_C)).json.data.requests) {
      const res = await answer(ATHLETE_C, r.id, { q1: `answer ${r.title}` });
      ids.push(res.json.data.id);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const base = `/trainers/me/clients/${ATHLETE_C}/form-responses`;
    const page1 = await http(
      "GET",
      `${base}?formId=${form.id}&limit=2`,
      COACH_A,
    );
    expect(page1.json.data).toHaveLength(2);
    expect(page1.json.nextCursor).toBeTruthy();
    const page2 = await http(
      "GET",
      `${base}?formId=${form.id}&limit=2&cursor=${encodeURIComponent(page1.json.nextCursor)}`,
      COACH_A,
    );
    expect(page2.json.data).toHaveLength(1);
    expect(page2.json.nextCursor).toBeNull();
    const all = [...page1.json.data, ...page2.json.data];
    expect(new Set(all.map((r: Json) => r.id)).size).toBe(3);
    expect(all.map((r: Json) => r.submittedAt)).toEqual(
      [...all.map((r: Json) => r.submittedAt)].sort().reverse(),
    );
    expect(
      (await http("GET", `${base}?cursor=junk`, COACH_A)).json.data,
    ).toHaveLength(4);

    const target = all[0].id;
    const r1 = await http("POST", `${base}/${target}/review`, COACH_A, {
      replyText: "Great work",
    });
    const r2 = await http("POST", `${base}/${target}/review`, COACH_A, {});
    expect(r2.json.data.reviewedAt).toBe(r1.json.data.reviewedAt);
    expect(r2.json.data.replyText).toBe("Great work");
    const r3 = await http("POST", `${base}/${target}/review`, COACH_A);
    expect(r3.status).toBe(200);
  });
});

describe("athlete list", () => {
  it("since returns changes and the ids that left the list", async () => {
    const form = await makeForm(COACH_A);
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    const first = await pending(ATHLETE_C);
    const req = first.json.data.requests[0];
    const since = new Date(Date.now() - 60_000).toISOString();
    await answer(ATHLETE_C, req.id, { q1: "x" });
    const changes = await http(
      "GET",
      `/users/me/form-requests?since=${encodeURIComponent(since)}`,
      ATHLETE_C,
    );
    expect(changes.json.data).toMatchObject({
      requests: [],
      deletedIds: [req.id],
    });
    expect(
      (await http("GET", "/users/me/form-requests?status=done", ATHLETE_C))
        .status,
    ).toBe(400);
    expect(
      (await http("GET", "/users/me/form-requests?since=nope", ATHLETE_C))
        .status,
    ).toBe(400);
  });
});

describe("set-up sections (starter_form, repeating_form)", () => {
  it("validates refs, previews titles, materialises on accept and copies from a client", async () => {
    const starter = await makeForm(COACH_A, "Starter");
    const weekly = await makeForm(COACH_A, "Weekly");
    const rule = await makeSchedule(COACH_A, {
      formId: weekly.id,
      trigger: "weekly",
      audience: "selected",
      clientIds: [ATHLETE_C],
      weekday: 1,
      timeLocal: "09:00",
    });
    const once = await makeSchedule(COACH_A, {
      formId: starter.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_E],
    });
    const join = await makeSchedule(COACH_A, {
      formId: weekly.id,
      trigger: "on_join",
      audience: "all_clients",
    });
    const bForm = await makeForm(COACH_B, "B form");

    const profile = await http(
      "POST",
      "/trainers/me/client-profiles",
      COACH_A,
      {
        displayName: "Frankie",
      },
    );
    const id = profile.json.data.id;
    const put = (section: string, items: unknown[]) =>
      http(
        "PUT",
        `/trainers/me/client-profiles/${id}/setup/${section}`,
        COACH_A,
        {
          items,
        },
      );
    for (const [section, items] of [
      ["starter_form", [{ config: {}, sortOrder: 0 }]],
      ["starter_form", [{ refId: bForm.id, config: {}, sortOrder: 0 }]],
      [
        "starter_form",
        [{ refId: starter.id, config: { dueAfterHours: 0 }, sortOrder: 0 }],
      ],
      ["repeating_form", [{ config: {}, sortOrder: 0 }]],
      ["repeating_form", [{ refId: join.id, config: {}, sortOrder: 0 }]],
      [
        "repeating_form",
        [{ refId: rule.id, config: { override: [] }, sortOrder: 0 }],
      ],
      [
        "repeating_form",
        [
          {
            refId: rule.id,
            config: { override: { weekday: 0 } },
            sortOrder: 0,
          },
        ],
      ],
    ] as [string, unknown[]][]) {
      const res = await put(section, items);
      expect([section, res.status]).toEqual([section, 400]);
    }
    expect(
      (
        await put("starter_form", [
          { refId: starter.id, config: { dueAfterHours: 24 }, sortOrder: 0 },
        ])
      ).status,
    ).toBe(200);
    expect(
      (
        await put("repeating_form", [
          {
            refId: rule.id,
            config: { override: { timeLocal: "07:00" } },
            sortOrder: 0,
          },
          { refId: once.id, config: {}, sortOrder: 1 },
        ])
      ).status,
    ).toBe(200);
    const preview = await http(
      "GET",
      `/trainers/me/client-profiles/${id}/preview`,
      COACH_A,
    );
    expect(preview.json.data.forms).toEqual([
      { title: "Starter" },
      { title: "Weekly" },
      { title: "Starter" },
    ]);

    // Accept: starter sent on_join (due 24h), the weekly and once rules gain
    // F as a target (once sends now), and the on_join rule sends Weekly.
    await http("POST", "/trainers/me/declaration", COACH_A, {
      statementVersion: currentDeclarationVersion(),
    });
    const invite = await http(
      "POST",
      `/trainers/me/client-profiles/${id}/invite`,
      COACH_A,
    );
    expect((await accept(ATHLETE_F, invite.json.data.code)).status).toBe(201);
    const rows = await requestsFor(ATHLETE_F);
    expect(
      rows
        .map((r) => `${r.trigger}:${r.formId === starter.id ? "S" : "W"}`)
        .sort(),
    ).toEqual(["on_join:S", "on_join:W", "once:S"]);
    const targets = await db
      .select()
      .from(schema.coachFormScheduleClients)
      .where(eq(schema.coachFormScheduleClients.clientId, ATHLETE_F));
    expect(targets.find((t) => t.scheduleId === rule.id)).toMatchObject({
      status: "active",
      override: { timeLocal: "07:00" },
    });

    // Copy-from F into a new profile brings the same set-up back.
    const copyTarget = await http(
      "POST",
      "/trainers/me/client-profiles",
      COACH_A,
      { displayName: "Next" },
    );
    const copied = await http(
      "POST",
      `/trainers/me/client-profiles/${copyTarget.json.data.id}/setup/copy-from`,
      COACH_A,
      {
        sourceClientId: ATHLETE_F,
        sections: ["starter_form", "repeating_form"],
      },
    );
    expect([copied.status, copied.json?.message]).toEqual([200, undefined]);
    const items = await db
      .select()
      .from(schema.coachClientSetupItems)
      .where(
        eq(schema.coachClientSetupItems.profileId, copyTarget.json.data.id),
      );
    expect(items.map((i) => `${i.section}:${i.refId}`).sort()).toEqual(
      [
        // Weekly reached F through the all-clients on_join rule, not the
        // set-up, so it isn't copied as a starter form (Inspector Brad, #543).
        `starter_form:${starter.id}`,
        `repeating_form:${rule.id}`,
        `repeating_form:${once.id}`,
      ].sort(),
    );
  });

  it("a form archived between set-up and accept is skipped", async () => {
    const starter = await makeForm(COACH_A, "Starter");
    const weekly = await makeForm(COACH_A, "Weekly");
    const rule = await makeSchedule(COACH_A, {
      formId: weekly.id,
      trigger: "daily",
      audience: "selected",
      clientIds: [ATHLETE_C],
      timeLocal: "09:00",
    });
    const { code } = await personalInvite({
      starter_form: [{ refId: starter.id, config: {}, sortOrder: 0 }],
      repeating_form: [{ refId: rule.id, config: {}, sortOrder: 0 }],
    });
    await http("DELETE", `/trainers/me/forms/${starter.id}`, COACH_A);
    await http("DELETE", `/trainers/me/forms/${weekly.id}`, COACH_A);
    const res = await accept(ATHLETE_F, code);
    expect(res.status).toBe(201);
    expect(await requestsFor(ATHLETE_F)).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.coachFormScheduleClients)
        .where(eq(schema.coachFormScheduleClients.clientId, ATHLETE_F)),
    ).toEqual([]);
  });
});

describe("generator and set-up edges", () => {
  it("never sends before the cycle started, and a relationship with no activated_at uses cycle c0", async () => {
    const form = await makeForm(COACH_A);
    const rel = await relationship(COACH_A, ATHLETE_C);
    const relE = await relationship(COACH_A, ATHLETE_E);
    await pg.exec(
      `update pt_client_relationships set activated_at = now() + interval '1 hour' where id = '${rel.id}';
       update pt_client_relationships set activated_at = null where id = '${relE.id}';`,
    );
    const s = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "all_clients",
    });
    const [c] = await requestsFor(ATHLETE_C);
    const fresh = await relationship(COACH_A, ATHLETE_C);
    expect(c!.sentAt.getTime()).toBe(fresh.activatedAt!.getTime());
    const [e] = await requestsFor(ATHLETE_E);
    expect(e!.periodKey).toBe(`once:${s.id}:c0`);
    // A non-once or paused rule generates nothing.
    const weekly = (
      await db
        .select()
        .from(schema.coachFormSchedules)
        .where(eq(schema.coachFormSchedules.id, s.id))
    )[0]!;
    expect(
      await generateOnce(realDb(), { ...weekly, trigger: "weekly" }),
    ).toEqual([]);
    expect(
      await generateOnce(realDb(), { ...weekly, status: "paused" }),
    ).toEqual([]);
  });

  it("a selected exit rule reaches only its targets", async () => {
    const exit = await makeForm(COACH_A, "Exit");
    await makeSchedule(COACH_A, {
      formId: exit.id,
      trigger: "on_end",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    await end(COACH_A, ATHLETE_E);
    expect(await requestsFor(ATHLETE_E)).toEqual([]);
    await end(COACH_A, ATHLETE_C);
    expect((await requestsFor(ATHLETE_C)).map((r) => r.trigger)).toEqual([
      "on_end",
    ]);
  });

  it("set-up hooks handle empty and unknown references", async () => {
    expect(
      await starterFormHandler.copyFromClient!(realDb(), COACH_D, ATHLETE_C),
    ).toEqual([]);
    expect(
      await repeatingFormHandler.copyFromClient!(realDb(), COACH_D, ATHLETE_C),
    ).toEqual([]);
    expect(await repeatingFormHandler.preview!(realDb(), [])).toEqual({
      forms: [],
    });
    const item = (refId: string | null) =>
      ({ refId, config: {} }) as unknown as schema.CoachClientSetupItem;
    expect(
      await starterFormHandler.preview!(realDb(), [
        item(null),
        item(randomUUID()),
      ]),
    ).toEqual({ forms: [] });
    expect(
      await repeatingFormHandler.preview!(realDb(), [item(randomUUID())]),
    ).toEqual({ forms: [] });
  });
});

describe("on_join for every way a relationship becomes active (Brad, 21 Nov)", () => {
  async function joinRule() {
    const form = await makeForm(COACH_A, "Welcome");
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "on_join",
      audience: "all_clients",
    });
    return form;
  }

  it("a coach accepting an athlete's request (general code) sends the join forms once", async () => {
    const form = await joinRule();
    const [rel] = await db
      .insert(schema.ptClientRelationships)
      .values({
        trainerId: COACH_A,
        clientId: ATHLETE_F,
        status: "pending",
        initiatedBy: "client",
      })
      .returning();
    const path = `/trainers/me/relationships/${rel!.id}/respond`;
    const res = await http("POST", path, COACH_A, { action: "accept" });
    expect(res.status).toBe(200);
    expect(
      (await http("POST", path, COACH_A, { action: "accept" })).status,
    ).toBe(404);
    const rows = await requestsFor(ATHLETE_F);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ formId: form.id, trigger: "on_join" });
  });

  it("an athlete accepting a coach's request sends the join forms", async () => {
    const form = await joinRule();
    const [rel] = await db
      .insert(schema.ptClientRelationships)
      .values({
        trainerId: COACH_A,
        clientId: ATHLETE_F,
        status: "pending",
        initiatedBy: "trainer",
      })
      .returning();
    const res = await http(
      "POST",
      `/clients/me/relationships/${rel!.id}/respond`,
      ATHLETE_F,
      { action: "accept", consent: true, consentVersion: "v1-2026-07" },
    );
    expect(res.status).toBe(200);
    const rows = await requestsFor(ATHLETE_F);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ formId: form.id, trigger: "on_join" });
    // Coach B's join rules never reach A's new client.
    const bForm = await makeForm(COACH_B, "B welcome");
    await makeSchedule(COACH_B, {
      formId: bForm.id,
      trigger: "on_join",
      audience: "all_clients",
    });
    expect(await requestsFor(ATHLETE_F)).toHaveLength(1);
  });
});

describe("Inspector Brad sweep 1 (PR #543)", () => {
  it("re-activating an excluded client on a once rule sends the form again", async () => {
    const form = await makeForm(COACH_A, "Goals");
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "all_clients",
      dueAfterHours: 24,
    });
    const setup = (status: string) =>
      http(
        "PUT",
        `/trainers/me/clients/${ATHLETE_C}/forms/${form.id}/setup`,
        COACH_A,
        { status },
      );
    expect((await setup("excluded")).status).toBe(200);
    expect((await requestsFor(ATHLETE_C))[0]!.status).toBe("cancelled");
    const back = await setup("active");
    expect(back.json.data.pendingRequestId).toBeTruthy();
    const rows = await requestsFor(ATHLETE_C);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", late: false });
    expect(rows[0]!.dueAt!.getTime() - rows[0]!.sentAt.getTime()).toBe(
      24 * 3600_000,
    );
    expect(
      (await pending(ATHLETE_C)).json.data.requests.map((r: Json) => r.id),
    ).toEqual([rows[0]!.id]);
  });

  it("a completed once request is never re-sent by re-activating", async () => {
    const form = await makeForm(COACH_A);
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "all_clients",
    });
    const [req] = await requestsFor(ATHLETE_C);
    await answer(ATHLETE_C, req!.id, { q1: "done" });
    await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${form.id}/setup`,
      COACH_A,
      { status: "active" },
    );
    const rows = await requestsFor(ATHLETE_C);
    expect(rows.map((r) => r.status)).toEqual(["completed"]);
  });

  it("offboarding's stops don't carry into the next coaching cycle", async () => {
    const weekly = await makeForm(COACH_A, "Weekly");
    const exit = await makeForm(COACH_A, "Exit");
    await makeSchedule(COACH_A, {
      formId: weekly.id,
      trigger: "weekly",
      audience: "all_clients",
      weekday: 7,
      timeLocal: "18:00",
    });
    await makeSchedule(COACH_A, {
      formId: exit.id,
      trigger: "on_end",
      audience: "all_clients",
    });
    // C has per-client rows on both all-clients rules.
    for (const formId of [weekly.id, exit.id]) {
      await http(
        "PUT",
        `/trainers/me/clients/${ATHLETE_C}/forms/${formId}/setup`,
        COACH_A,
        { status: "active" },
      );
    }
    expect((await end(COACH_A, ATHLETE_C)).ok).toBe(true);
    // C comes back (the same relationship row is revived).
    const rel = await relationship(COACH_A, ATHLETE_C);
    await pg.exec(
      `update pt_client_relationships set status = 'active' where id = '${rel.id}'`,
    );
    const tab = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/forms`,
      COACH_A,
    );
    expect(tab.json.data.map((f: Json) => f.form.title).sort()).toEqual([
      "Exit",
      "Weekly",
    ]);
    expect((await end(COACH_A, ATHLETE_C)).ok).toBe(true);
    const exits = (await requestsFor(ATHLETE_C)).filter(
      (r) => r.trigger === "on_end",
    );
    expect(exits).toHaveLength(2);
  });

  it("a client who joins after an all-clients once rule exists gets it", async () => {
    const form = await makeForm(COACH_A, "Survey");
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "all_clients",
    });
    const [rel] = await db
      .insert(schema.ptClientRelationships)
      .values({
        trainerId: COACH_A,
        clientId: ATHLETE_F,
        status: "pending",
        initiatedBy: "client",
      })
      .returning();
    const res = await http(
      "POST",
      `/trainers/me/relationships/${rel!.id}/respond`,
      COACH_A,
      { action: "accept" },
    );
    expect(res.status).toBe(200);
    const rows = await requestsFor(ATHLETE_F);
    expect(rows.map((r) => r.trigger)).toEqual(["once"]);
    const tab = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_F}/forms`,
      COACH_A,
    );
    expect(tab.json.data[0].pendingRequestId).toBe(rows[0]!.id);
  });
});

describe("Inspector Brad sweep 2 (PR #543)", () => {
  it("narrowing a rule from all_clients to selected cancels the dropped clients' requests and needs clientIds", async () => {
    const form = await makeForm(COACH_A);
    const s = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "all_clients",
    });
    expect(await requestsFor(ATHLETE_C)).toHaveLength(1);
    expect(await requestsFor(ATHLETE_E)).toHaveLength(1);
    const patch = (body: object) =>
      http("PATCH", `/trainers/me/form-schedules/${s.id}`, COACH_A, body);
    const noTargets = await patch({ audience: "selected" });
    expect(noTargets.status).toBe(422);
    expect(noTargets.json.message).toMatch(/selected needs/);
    const narrowed = await patch({
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    expect(narrowed.status).toBe(200);
    expect((await requestsFor(ATHLETE_C))[0]!.status).toBe("pending");
    expect((await requestsFor(ATHLETE_E))[0]!.status).toBe("cancelled");
  });
});

describe("Inspector Brad sweep 3 (PR #543)", () => {
  it("editing or stopping an exit rule never cancels an exit form already sent", async () => {
    const exit = await makeForm(COACH_A, "Exit");
    const s = await makeSchedule(COACH_A, {
      formId: exit.id,
      trigger: "on_end",
      audience: "selected",
      clientIds: [ATHLETE_C, ATHLETE_E],
    });
    await end(COACH_A, ATHLETE_C);
    const [sent] = await requestsFor(ATHLETE_C);
    expect(sent).toMatchObject({ trigger: "on_end", status: "pending" });
    const patched = await http(
      "PATCH",
      `/trainers/me/form-schedules/${s.id}`,
      COACH_A,
      { clientIds: [ATHLETE_E] },
    );
    expect(patched.status).toBe(200);
    expect((await requestsFor(ATHLETE_C))[0]!.status).toBe("pending");
    expect(
      (await http("DELETE", `/trainers/me/form-schedules/${s.id}`, COACH_A))
        .status,
    ).toBe(204);
    expect((await requestsFor(ATHLETE_C))[0]!.status).toBe("pending");
    expect((await answer(ATHLETE_C, sent!.id, { q1: "bye" })).status).toBe(201);
  });
});

// ─── PER-129: library stats (C10a/C10g) and C10b question extras ────────────

describe("form stats (PER-129, C10a/C10g)", () => {
  const stats = async (coach = COACH_A) => {
    const res = await http("GET", "/trainers/me/forms/stats", coach);
    expect(res.status).toBe(200);
    return res.json.data as Json;
  };

  it("counts each client's latest request, lists outstanding first with the last reminder", async () => {
    const weekly = await makeForm(COACH_A, "Weekly check-in");
    const goals = await makeForm(COACH_A, "Goals");
    await makeForm(COACH_A, "Unsent");
    const rule = await makeSchedule(COACH_A, {
      formId: goals.id,
      trigger: "once",
      audience: "all_clients",
      dueAfterHours: 24,
      reminders: [{ afterHours: 2 }, { afterHours: 9 }],
    });
    await makeSchedule(COACH_A, {
      formId: weekly.id,
      trigger: "weekly",
      audience: "all_clients",
      weekday: 7,
      timeLocal: "09:00",
    });
    // C answers; E has had one reminder and is still pending.
    const forC = (await pending(ATHLETE_C)).json.data.requests[0];
    expect((await answer(ATHLETE_C, forC.id, { q1: "Squat" })).status).toBe(
      201,
    );
    const relE = await relationship(COACH_A, ATHLETE_E);
    await db
      .update(schema.coachFormRequests)
      .set({ remindersSent: 1 })
      .where(eq(schema.coachFormRequests.relationshipId, relE.id));

    const data = await stats();
    expect(data.totals).toMatchObject({
      forms: 3,
      repeating: 1,
      outstanding: 1,
      onTimeRate: null,
      onTimeSample: 0,
    });
    expect(data.forms).toHaveLength(1);
    const g = data.forms[0];
    expect(g).toMatchObject({
      formId: goals.id,
      reached: 2,
      done: 1,
      outstanding: 1,
    });
    expect(g.clients.map((c: Json) => [c.name, c.status])).toEqual([
      ["Lena", "pending"],
      ["Chris", "done"],
    ]);
    const lena = g.clients[0];
    expect(
      new Date(lena.lastReminderAt).getTime() - new Date(lena.sentAt).getTime(),
    ).toBe(2 * 3600_000);
    expect(g.clients[1].lastReminderAt).toBeNull();
    expect(rule.id).toBeTruthy();
    // Coach B sees none of it; D has an empty library.
    expect((await stats(COACH_B)).forms).toEqual([]);
    expect((await stats(COACH_D)).totals.forms).toBe(0);
  });

  it("on time is over requests due in the last 4 weeks; missed counts as outstanding", async () => {
    const form = await makeForm(COACH_A);
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "all_clients",
      dueAfterHours: 1,
    });
    const [c] = (await pending(ATHLETE_C)).json.data.requests;
    await answer(ATHLETE_C, c.id, { q1: "Done" });
    // Both were due an hour ago, so both count; E's is now missed.
    const sent = new Date(Date.now() - 2 * 3600_000);
    await db
      .update(schema.ptClientRelationships)
      .set({ activatedAt: new Date(Date.now() - 24 * 3600_000) });
    await db
      .update(schema.coachFormRequests)
      .set({ sentAt: sent, dueAt: new Date(sent.getTime() + 3600_000) });
    await db
      .update(schema.coachFormRequests)
      .set({ completedAt: new Date(sent.getTime() + 600_000) })
      .where(eq(schema.coachFormRequests.clientId, ATHLETE_C));
    const data = await stats();
    expect(data.totals).toMatchObject({
      outstanding: 1,
      onTimeRate: 0.5,
      onTimeSample: 2,
    });
    expect(data.forms[0].clients.map((x: Json) => x.status)).toEqual([
      "missed",
      "done",
    ]);
    // A client who left drops out of the counts.
    await end(COACH_A, ATHLETE_E);
    expect((await stats()).forms[0]).toMatchObject({ reached: 1, done: 1 });
  });

  it("a client override's reminders give the last reminder time; cancelled requests are left out", async () => {
    const form = await makeForm(COACH_A);
    const s = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C, ATHLETE_E],
      reminders: [{ afterHours: 2 }],
    });
    await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${form.id}/setup`,
      COACH_A,
      { status: "active", override: { reminders: [{ afterHours: 5 }] } },
    );
    await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_E}/forms/${form.id}/setup`,
      COACH_A,
      { status: "excluded", scheduleId: s.id },
    );
    await db
      .update(schema.coachFormRequests)
      .set({ remindersSent: 3 })
      .where(eq(schema.coachFormRequests.clientId, ATHLETE_C));
    const data = await stats();
    const [only] = data.forms[0].clients;
    expect(data.forms[0].reached).toBe(1);
    expect(
      new Date(only.lastReminderAt).getTime() - new Date(only.sentAt).getTime(),
    ).toBe(5 * 3600_000);
  });

  it("no rule (a starter form) or no name still reports, with no reminder time", async () => {
    const form = await makeForm(COACH_A);
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C, ATHLETE_E],
      reminders: [{ afterHours: 4 }],
    });
    // C: an override without reminders keeps the rule's; E: no rule at all.
    await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${form.id}/setup`,
      COACH_A,
      { status: "active", override: { dueAfterHours: 12 } },
    );
    await db.update(schema.coachFormRequests).set({ remindersSent: 1 });
    await db
      .update(schema.coachFormRequests)
      .set({ scheduleId: null })
      .where(eq(schema.coachFormRequests.clientId, ATHLETE_E));
    await db
      .update(schema.profiles)
      .set({ fullName: null })
      .where(eq(schema.profiles.id, ATHLETE_E));
    const clients = (await stats()).forms[0].clients as Json[];
    const c = clients.find((x) => x.clientId === ATHLETE_C);
    const e = clients.find((x) => x.clientId === ATHLETE_E);
    expect(
      new Date(c.lastReminderAt).getTime() - new Date(c.sentAt).getTime(),
    ).toBe(4 * 3600_000);
    expect(e).toMatchObject({ name: null, lastReminderAt: null });
  });

  it("a client's earlier coaching cycle doesn't count", async () => {
    const form = await makeForm(COACH_A);
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    await db
      .update(schema.ptClientRelationships)
      .set({ activatedAt: new Date(Date.now() + 60_000) })
      .where(
        and(
          eq(schema.ptClientRelationships.trainerId, COACH_A),
          eq(schema.ptClientRelationships.clientId, ATHLETE_C),
        ),
      );
    expect((await stats()).forms).toEqual([]);
  });
});

describe("C10b question extras over HTTP (PER-129)", () => {
  it("stores help, details if yes and filled-for-them, and takes a details answer", async () => {
    const form = await makeForm(COACH_A, "Weekly", [
      {
        id: "pain",
        type: "yes_no",
        prompt: "Any pain or niggles?",
        help: "Where is it, and how bad?",
        detailsIfYes: true,
        required: true,
      },
      {
        id: "weight",
        type: "number",
        prompt: "Weight",
        unit: "kg",
        prefill: "weight",
      },
    ]);
    expect(form.version.questions[0]).toMatchObject({
      help: "Where is it, and how bad?",
      detailsIfYes: true,
    });
    expect(form.version.questions[1].prefill).toBe("weight");
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    const [req] = (await pending(ATHLETE_C)).json.data.requests;
    expect(req.version.questions[0].detailsIfYes).toBe(true);
    const res = await answer(ATHLETE_C, req.id, {
      pain: { value: true, details: "Left knee, mild" },
      weight: 82.4,
    });
    expect(res.status).toBe(201);
    expect(res.json.data.answers.pain).toEqual({
      value: true,
      details: "Left knee, mild",
    });
    const bad = await makeFormRaw([
      { id: "x", type: "short_text", prompt: "X", prefill: "steps" },
    ]);
    expect(bad.status).toBe(422);
  });

  const makeFormRaw = (questions: unknown[]) =>
    http("POST", "/trainers/me/forms", COACH_A, { title: "T", questions });
});

describe("Inspector Brad #555", () => {
  it("copy set-up keeps one client's own cadence (override.trigger)", async () => {
    const form = await makeForm(COACH_A);
    const s = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    const set = await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${form.id}/setup`,
      COACH_A,
      {
        status: "active",
        scheduleId: s.id,
        override: { trigger: "weekly", weekday: 1, timeLocal: "07:00" },
      },
    );
    expect(set.status).toBe(200);
    const profile = await http(
      "POST",
      "/trainers/me/client-profiles",
      COACH_A,
      { displayName: "Frankie" },
    );
    const copied = await http(
      "POST",
      `/trainers/me/client-profiles/${profile.json.data.id}/setup/copy-from`,
      COACH_A,
      { sourceClientId: ATHLETE_C },
    );
    expect([copied.status, copied.json?.message]).toEqual([200, undefined]);
    expect(copied.json.data.setup.repeating_form[0].config.override).toEqual({
      trigger: "weekly",
      weekday: 1,
      timeLocal: "07:00",
    });
  });

  it("library totals leave out archived forms", async () => {
    const kept = await makeForm(COACH_A, "Kept");
    const gone = await makeForm(COACH_A, "Gone");
    for (const f of [kept, gone]) {
      await makeSchedule(COACH_A, {
        formId: f.id,
        trigger: "once",
        audience: "selected",
        clientIds: [ATHLETE_C],
      });
    }
    expect(
      (await http("DELETE", `/trainers/me/forms/${gone.id}`, COACH_A)).status,
    ).toBe(204);
    const stats = (await http("GET", "/trainers/me/forms/stats", COACH_A)).json
      .data;
    expect(stats.totals).toMatchObject({ forms: 1, outstanding: 1 });
    expect(stats.forms.map((f: Json) => f.formId)).toEqual([kept.id]);
  });
});
