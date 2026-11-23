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
 * PER-117 (BE-C2) — design C's D7 tests 2 (time zones), 3 (reminders),
 * 7 (events) and 9 (contract), plus the routes, two-coach isolation, the
 * scheduler's claims and the migration. Real migrations (PER-108, PER-116 and
 * this one) on PGlite, real handlers and jobs. Only the edges are stubbed:
 * the JWT (bearer token = user id), the seat evaluator, and push delivery,
 * which is replaced by a recorder that still writes the inbox row (so the
 * "announced once" check reads real data).
 */

const holder = vi.hoisted(() => ({ db: null as unknown }));
const pushes = vi.hoisted(() => ({
  list: [] as { userId: string; input: Record<string, unknown> }[],
}));

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
    async createAndDispatch(userId: string, input: Record<string, unknown>) {
      pushes.list.push({ userId, input });
      const s = await import("@persistence/db/schema");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = holder.db as any;
      const rows = await db
        .insert(s.notifications)
        .values({ userId, ...input })
        .returning();
      return rows[0];
    }
    async dispatchExisting() {}
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
import { trainersRespondToRequestHandler } from "../../../trainers/relationships/trainersRespondToRequestHandler";
import { notificationsListHandler } from "../../../notifications/list/notificationsListHandler";
import { NOTIFICATION_TYPES } from "../../../repositories/notificationRepository";
import { NotificationDispatcher } from "../../../notifications/push/notificationDispatcher";
import type { DbOrTx } from "../../../repositories/personalRecordsRepository";
import {
  deliverCoachEvents,
  initialPushState,
  recordCoachEvent,
} from "../coachEvents";
import {
  recordClientAccepted,
  recordWorkoutCompleted,
  safeRecordWorkoutCompleted,
} from "../writers";
import { decodeCursor } from "../feedRepository";
import { pushText } from "../kinds";
import {
  defaultContext,
  runCoachScheduler,
  tickKey,
  type SchedulerJob,
} from "../../scheduler/coachScheduler";
import { COACH_SCHEDULER_JOBS } from "../../scheduler/jobs";
import { formPeriodsJob } from "../../scheduler/jobs/formPeriods";
import {
  formPushesJob,
  missedFormsJob,
  reminderCandidates,
  reminderList,
} from "../../scheduler/jobs/formRequests";
import { coachPushesJob } from "../../scheduler/jobs/coachPushes";
import {
  inviteExpiryJob,
  programmeEndingJob,
  trainingBehindJob,
} from "../../scheduler/jobs/coachChecks";
import { isoWeekKey } from "../../scheduler/zonedTime";
import { PAGE_SIZES } from "../../scheduler/jobs/pageSizes";
import preferences120 from "./fixtures/notification-preferences-1.2.0.json";

const MIGRATIONS = "../../../../../../../supabase/migrations/";
const ROLLBACKS = "../../../../../../../supabase/rollbacks/";
const read = (dir: string, file: string) =>
  readFile(new URL(`${dir}${file}`, import.meta.url), "utf8");
const A1 = "20261120120000_coaching_relationships_client_profiles.sql";
const FORMS = "20261120235941_coach_forms.sql";
const MIGRATION = "20261123120117_coach_events_notifications.sql";

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
  schema.nutritionPlans,
  schema.nutritionPlanAssignments,
  schema.workoutSessions,
  schema.sessionExercises,
  schema.exerciseSets,
  schema.exercises,
  schema.personalRecords,
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

const NOTIFICATION_ENUM =
  "DO $$ BEGIN CREATE TYPE notification_type AS ENUM ('coach_brief'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;";

/** Design A and C's forms applied, BEFORE this migration. */
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
  await pg.exec(await read(MIGRATIONS, FORMS));
  await pg.exec(NOTIFICATION_ENUM);
  return pg;
}

const COACH_A = randomUUID();
const COACH_B = randomUUID();
const ATHLETE_C = randomUUID();
const ATHLETE_E = randomUUID();
const ATHLETE_G = randomUUID();
const COACHED_SINCE = new Date("2020-01-01T00:00:00Z");

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const realDb = () => db as unknown as DbOrTx;
const dispatcher = () => new NotificationDispatcher();
const ctx = (now: Date) => ({ now, dispatcher: dispatcher() });

const app = new Elysia()
  .use(coreErrorHandler)
  .use(coachingRoutes)
  .use(trainersRespondToRequestHandler)
  .use(notificationsListHandler);

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

const relationshipId = async (trainerId: string, clientId: string) =>
  (
    await db
      .select({ id: schema.ptClientRelationships.id })
      .from(schema.ptClientRelationships)
      .where(
        and(
          eq(schema.ptClientRelationships.trainerId, trainerId),
          eq(schema.ptClientRelationships.clientId, clientId),
        ),
      )
  )[0]!.id;

const eventsOf = async (trainerId: string) =>
  db
    .select()
    .from(schema.coachEvents)
    .where(eq(schema.coachEvents.trainerId, trainerId));

const pushesTo = (userId: string) =>
  pushes.list.filter((p) => p.userId === userId);

async function makeForm(coach: string, title = "Weekly check-in") {
  const res = await http("POST", "/trainers/me/forms", coach, {
    title,
    questions: [{ id: "q1", type: "short_text", prompt: "How was it?" }],
  });
  expect(res.status).toBe(201);
  return res.json.data as Json;
}

async function makeSchedule(coach: string, body: object) {
  const res = await http("POST", "/trainers/me/form-schedules", coach, body);
  expect(res.status).toBe(201);
  // Rules made "now" by the API would never cover the dates the tests use.
  await db
    .update(schema.coachFormSchedules)
    .set({ createdAt: COACHED_SINCE })
    .where(eq(schema.coachFormSchedules.id, res.json.data.id));
  return res.json.data as Json;
}

const requestsFor = async (clientId: string) =>
  db
    .select()
    .from(schema.coachFormRequests)
    .where(eq(schema.coachFormRequests.clientId, clientId));

async function setAlertMode(
  trainerId: string,
  clientId: string,
  alertMode: "default" | "mute" | "everything",
  extra: Partial<typeof schema.coachClientSettings.$inferInsert> = {},
) {
  const rel = await relationshipId(trainerId, clientId);
  await db
    .insert(schema.coachClientSettings)
    .values({ relationshipId: rel, trainerId, clientId, alertMode, ...extra })
    .onConflictDoUpdate({
      target: schema.coachClientSettings.relationshipId,
      set: { alertMode, ...extra },
    });
}

let exerciseId: string;

async function completedSession(
  userId: string,
  opts: {
    completedAt?: Date;
    rating?: number | null;
    difficulty?: number | null;
    note?: string | null;
    record?: boolean;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const completedAt = opts.completedAt ?? new Date();
  await db.insert(schema.workoutSessions).values({
    id,
    userId,
    name: "Upper B",
    status: "completed",
    startedAt: new Date(completedAt.getTime() - 3_600_000),
    completedAt,
    sessionRating: opts.rating ?? null,
    difficultyRanking: opts.difficulty ?? null,
    userNotes: opts.note ?? null,
    totalDurationSeconds: 3600,
  });
  if (opts.record) {
    const seId = randomUUID();
    const setId = randomUUID();
    await db.insert(schema.sessionExercises).values({
      id: seId,
      sessionId: id,
      exerciseId,
      sortOrder: 1,
    });
    await db.insert(schema.exerciseSets).values({
      id: setId,
      sessionExerciseId: seId,
      setNumber: 1,
      reps: 5,
      weightKg: "100",
    });
    await db.insert(schema.personalRecords).values({
      userId,
      exerciseId,
      recordType: "max_weight",
      value: "100",
      setId,
    });
  }
  return id;
}

beforeAll(async () => {
  pg = await baseDatabase();
  await pg.exec(await read(MIGRATIONS, MIGRATION));
  db = drizzle(pg, { schema });
  holder.db = db;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  pushes.list = [];
  await pg.exec(
    `truncate coach_scheduler_runs, coach_notification_settings, coach_events,
       coach_form_responses, coach_form_requests, coach_form_schedule_clients,
       coach_form_schedules, coach_form_versions, coach_forms,
       trainer_declarations, coach_client_settings, coach_client_setup_items,
       trainer_invite_codes, coach_client_profiles,
       ${BASE_TABLES.map((t) => `"${getTableConfig(t).name}"`).join(",")} cascade`,
  );
  await db.insert(schema.profiles).values([
    {
      id: COACH_A,
      fullName: "Ellie",
      role: "personal_trainer",
      timezone: "Europe/London",
    },
    {
      id: COACH_B,
      fullName: "Marcus",
      role: "physiotherapist",
      timezone: "Europe/London",
    },
    {
      id: ATHLETE_C,
      fullName: "Chris",
      role: "user",
      timezone: "Europe/London",
    },
    {
      id: ATHLETE_E,
      fullName: "Lena",
      role: "user",
      timezone: "America/New_York",
    },
    { id: ATHLETE_G, fullName: "Gus", role: "user", timezone: "Europe/London" },
  ]);
  // A coaches C and E; B coaches C. G has no coach.
  await db.insert(schema.ptClientRelationships).values([
    {
      trainerId: COACH_A,
      clientId: ATHLETE_C,
      status: "active",
      activatedAt: COACHED_SINCE,
    },
    {
      trainerId: COACH_A,
      clientId: ATHLETE_E,
      status: "active",
      activatedAt: COACHED_SINCE,
    },
    {
      trainerId: COACH_B,
      clientId: ATHLETE_C,
      status: "active",
      activatedAt: COACHED_SINCE,
    },
  ]);
  exerciseId = randomUUID();
  await db.insert(schema.exercises).values({ id: exerciseId, name: "Bench" });
});

// ─── D7.2 Time zones ─────────────────────────────────────────────────────────

/** Runs the period generator every 15 minutes over [from, to). */
async function tickThrough(from: string, to: string) {
  const end = new Date(to).getTime();
  for (let t = new Date(from).getTime(); t < end; t += 15 * 60_000) {
    await formPeriodsJob.run(ctx(new Date(t)));
  }
}

const sentAt = async (clientId: string, periodKey: string) => {
  const rows = (await requestsFor(clientId)).filter(
    (r) => r.periodKey === periodKey,
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.sentAt.toISOString();
};

describe("D7.2 time zones", () => {
  it("a weekly Sunday 18:00 send goes out at 18:00 local in London and New York, across both clock changes", async () => {
    const form = await makeForm(COACH_A);
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "weekly",
      audience: "all_clients",
      weekday: 7,
      timeLocal: "18:00",
    });
    // [Sunday, London 18:00 in UTC, New York 18:00 in UTC]
    const sundays: [string, string, string][] = [
      // London back to GMT that morning; New York still EDT.
      ["2026-10-25", "2026-10-25T18:00:00.000Z", "2026-10-25T22:00:00.000Z"],
      // New York back to EST that morning.
      ["2026-11-01", "2026-11-01T18:00:00.000Z", "2026-11-01T23:00:00.000Z"],
      // New York forward to EDT; London still GMT.
      ["2027-03-14", "2027-03-14T18:00:00.000Z", "2027-03-14T22:00:00.000Z"],
      // London forward to BST.
      ["2027-03-28", "2027-03-28T17:00:00.000Z", "2027-03-28T22:00:00.000Z"],
    ];
    for (const [sunday, london, newYork] of sundays) {
      await tickThrough(`${sunday}T12:00:00Z`, `${sunday}T23:59:00Z`);
      // The tick that first reaches the time, and nothing before it.
      const week = isoWeekKey(sunday);
      expect([sunday, await sentAt(ATHLETE_C, week)]).toEqual([sunday, london]);
      expect([sunday, await sentAt(ATHLETE_E, week)]).toEqual([
        sunday,
        newYork,
      ]);
    }
    // One request per client per week: 4 each.
    expect(await requestsFor(ATHLETE_C)).toHaveLength(4);
    expect(await requestsFor(ATHLETE_E)).toHaveLength(4);
    // The 25 Oct week was still pending when 1 Nov went out → missed, and
    // the coach heard once per missed request.
    const oct = (await requestsFor(ATHLETE_C)).find(
      (r) => r.periodKey === isoWeekKey("2026-10-25"),
    )!;
    expect(oct.status).toBe("missed");
    const missed = (await eventsOf(COACH_A)).filter(
      (e) => e.kind === "form_missed",
    );
    // Each new week misses the one before it while still pending: Oct→Nov,
    // Nov→Mar 14, Mar 14→Mar 28, for C and for E.
    expect(missed).toHaveLength(6);
  });

  it("a daily 00:30 send goes out once on each clock-change night, in each zone", async () => {
    const form = await makeForm(COACH_A, "Daily");
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "daily",
      audience: "all_clients",
      timeLocal: "00:30",
    });
    // London's two nights.
    await tickThrough("2026-10-24T20:00:00Z", "2026-10-25T08:00:00Z");
    await tickThrough("2027-03-27T20:00:00Z", "2027-03-28T08:00:00Z");
    // 00:30 BST on the night the clocks go back = 23:30 UTC the day before.
    expect(await sentAt(ATHLETE_C, "2026-10-25")).toBe(
      "2026-10-24T23:30:00.000Z",
    );
    // 00:30 GMT, half an hour before the clocks go forward.
    expect(await sentAt(ATHLETE_C, "2027-03-28")).toBe(
      "2027-03-28T00:30:00.000Z",
    );
    // New York's two nights (and E got London's dates in her own zone).
    await tickThrough("2026-11-01T00:00:00Z", "2026-11-01T12:00:00Z");
    await tickThrough("2027-03-14T00:00:00Z", "2027-03-14T12:00:00Z");
    expect(await sentAt(ATHLETE_E, "2026-11-01")).toBe(
      "2026-11-01T04:30:00.000Z",
    );
    expect(await sentAt(ATHLETE_E, "2027-03-14")).toBe(
      "2027-03-14T05:30:00.000Z",
    );
    // Exactly one request per local date, none skipped or doubled.
    // (The New York nights' ticks also reach London's 00:30 on those dates.)
    const keysC = (await requestsFor(ATHLETE_C)).map((r) => r.periodKey).sort();
    expect(keysC).toEqual([
      "2026-10-25",
      "2026-11-01",
      "2027-03-14",
      "2027-03-28",
    ]);
    const keysE = (await requestsFor(ATHLETE_E)).map((r) => r.periodKey).sort();
    expect(keysE).toEqual([
      "2026-10-25",
      "2026-11-01",
      "2027-03-14",
      "2027-03-28",
    ]);
  });

  it("never sends for a time before the client's coaching began, and honours a per-client time", async () => {
    const form = await makeForm(COACH_A);
    const rule = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "daily",
      audience: "all_clients",
      timeLocal: "09:00",
    });
    // E started being coached at 10:00 London on the day: today's 09:00
    // (her zone: 14:00 UTC) is fine, C started after his 09:00 → nothing.
    await db
      .update(schema.ptClientRelationships)
      .set({ activatedAt: new Date("2026-11-23T10:00:00Z") })
      .where(
        eq(
          schema.ptClientRelationships.id,
          await relationshipId(COACH_A, ATHLETE_C),
        ),
      );
    // C's own rule: 20:00 instead.
    const setup = await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${form.id}/setup`,
      COACH_A,
      { status: "active", override: { timeLocal: "20:00" } },
    );
    expect(setup.status).toBe(200);
    await tickThrough("2026-11-23T08:00:00Z", "2026-11-23T21:00:00Z");
    expect(await sentAt(ATHLETE_C, "2026-11-23")).toBe(
      "2026-11-23T20:00:00.000Z",
    );
    expect(await sentAt(ATHLETE_E, "2026-11-23")).toBe(
      "2026-11-23T14:00:00.000Z",
    );
    expect(rule.trigger).toBe("daily");
  });
});

describe("batch caps never skip rows (Inspector Brad, #548)", () => {
  const sizes = { ...PAGE_SIZES };
  beforeEach(() => {
    PAGE_SIZES.formRules = 1;
    PAGE_SIZES.behindTrainers = 1;
    PAGE_SIZES.heldTrainers = 1;
    PAGE_SIZES.expiredInvites = 1;
    PAGE_SIZES.endingProgrammes = 1;
  });
  afterAll(() => Object.assign(PAGE_SIZES, sizes));

  it("every expired invite and every programme ending soon is announced in one run", async () => {
    const now = new Date("2026-11-23T12:00:00Z");
    for (const name of ["Sam", "Ana"]) {
      const profileId = randomUUID();
      await db.insert(schema.coachClientProfiles).values({
        id: profileId,
        trainerId: COACH_A,
        displayName: name,
        status: "invited",
      });
      await db.insert(schema.trainerInviteCodes).values({
        trainerId: COACH_A,
        code: `X${name.toUpperCase()}0001`,
        status: "active",
        expiresAt: new Date("2026-11-23T11:00:00Z"),
        clientProfileId: profileId,
      });
    }
    await inviteExpiryJob.run(ctx(now));
    const program = randomUUID();
    await db.insert(schema.workoutPrograms).values({
      id: program,
      name: "Block 2",
    } as typeof schema.workoutPrograms.$inferInsert);
    for (const clientId of [ATHLETE_C, ATHLETE_E]) {
      await db.insert(schema.programAssignments).values({
        programId: program,
        clientId,
        assignedBy: COACH_A,
        startDate: "2026-10-01",
        endDate: "2026-11-27",
        status: "started",
      });
    }
    await programmeEndingJob.run(ctx(now));
    const kinds = (await eventsOf(COACH_A)).map((e) => e.kind).sort();
    expect(kinds).toEqual([
      "invite_expired",
      "invite_expired",
      "programme_ending",
      "programme_ending",
    ]);
  });

  it("every active rule sends, however many there are", async () => {
    for (const coach of [COACH_A, COACH_B]) {
      const form = await makeForm(coach, `Daily ${coach}`);
      await makeSchedule(coach, {
        formId: form.id,
        trigger: "daily",
        audience: "all_clients",
        timeLocal: "09:00",
      });
    }
    await formPeriodsJob.run(ctx(new Date("2026-11-23T09:00:00Z")));
    const forC = await requestsFor(ATHLETE_C);
    expect(forC.map((r) => r.trainerId).sort()).toEqual(
      [COACH_A, COACH_B].sort(),
    );
  });

  it("every coach who tracks training is checked", async () => {
    await setAlertMode(COACH_A, ATHLETE_C, "default", {
      trackTraining: true,
      sessionsPerWeek: 2,
    });
    await setAlertMode(COACH_B, ATHLETE_C, "default", {
      trackTraining: true,
      sessionsPerWeek: 2,
    });
    await trainingBehindJob.run(ctx(new Date("2026-11-23T09:00:00Z")));
    expect(await eventsOf(COACH_A)).toHaveLength(1);
    expect(await eventsOf(COACH_B)).toHaveLength(1);
  });

  it("a coach still in quiet hours never blocks another coach's release", async () => {
    // B (New York) is still quiet at 07:00 UTC; A (London) is not.
    await db
      .update(schema.profiles)
      .set({ timezone: "America/New_York" })
      .where(eq(schema.profiles.id, COACH_B));
    for (const coach of [COACH_B, COACH_A]) {
      await http("PUT", "/trainers/me/notification-settings", coach, {
        quietHours: { enabled: true, from: "22:00", until: "07:00" },
      });
    }
    // B's event is older, so it sorts first.
    await recordCoachEvent(
      realDb(),
      {
        trainerId: COACH_B,
        clientId: ATHLETE_C,
        relationshipId: await relationshipId(COACH_B, ATHLETE_C),
        kind: "form_missed",
        dedupeKey: "b",
      },
      new Date("2026-11-24T03:30:00Z"),
    );
    await recordCoachEvent(
      realDb(),
      {
        trainerId: COACH_A,
        clientId: ATHLETE_E,
        relationshipId: await relationshipId(COACH_A, ATHLETE_E),
        kind: "form_missed",
        dedupeKey: "a",
      },
      new Date("2026-11-24T05:00:00Z"),
    );
    await coachPushesJob.run(ctx(new Date("2026-11-24T07:00:00Z")));
    expect(pushesTo(COACH_A).map((p) => p.input.title)).toEqual([
      "Lena missed a form",
    ]);
    expect(pushesTo(COACH_B)).toHaveLength(0);
  });
});

describe("D7.2 a period whose missed-marking failed", () => {
  it("still marks the previous period missed on the next tick", async () => {
    // Inspector Brad, #548: the insert succeeded, the missed-marking threw,
    // and the next tick skipped it because the insert was no longer new.
    const form = await makeForm(COACH_A, "Daily");
    const rule = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "daily",
      audience: "selected",
      clientIds: [ATHLETE_C],
      timeLocal: "09:00",
    });
    await formPeriodsJob.run(ctx(new Date("2026-11-22T09:00:00Z")));
    // Today's request exists, as if the failed run had inserted it.
    const [yesterday] = await requestsFor(ATHLETE_C);
    await db.insert(schema.coachFormRequests).values({
      trainerId: COACH_A,
      clientId: ATHLETE_C,
      relationshipId: yesterday!.relationshipId,
      formId: form.id,
      formVersionId: yesterday!.formVersionId,
      scheduleId: rule.id,
      trigger: "daily",
      periodKey: "2026-11-23",
      sentAt: new Date("2026-11-23T09:00:00Z"),
    });
    await formPeriodsJob.run(ctx(new Date("2026-11-23T09:15:00Z")));
    const rows = await requestsFor(ATHLETE_C);
    expect(rows.map((r) => [r.periodKey, r.status]).sort()).toEqual([
      ["2026-11-22", "missed"],
      ["2026-11-23", "pending"],
    ]);
    expect(
      (await eventsOf(COACH_A)).filter((e) => e.kind === "form_missed"),
    ).toHaveLength(1);
  });
});

describe("D7.2 a form_missed event write that fails", () => {
  it("rolls the missed status back, so the next tick marks it and tells the coach", async () => {
    // Inspector Brad, #548: the status committed before the event write.
    const form = await makeForm(COACH_A, "Daily");
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "daily",
      audience: "selected",
      clientIds: [ATHLETE_C],
      timeLocal: "09:00",
    });
    await formPeriodsJob.run(ctx(new Date("2026-11-22T09:00:00Z")));
    await pg.exec(`
      create function fail_form_missed() returns trigger language plpgsql as $$
      begin
        if new.kind = 'form_missed' then raise exception 'event write failed'; end if;
        return new;
      end $$;
      create trigger fail_form_missed before insert on coach_events
        for each row execute function fail_form_missed();
    `);
    try {
      await expect(
        formPeriodsJob.run(ctx(new Date("2026-11-23T09:00:00Z"))),
      ).rejects.toThrow();
    } finally {
      await pg.exec(
        "drop trigger fail_form_missed on coach_events; drop function fail_form_missed();",
      );
    }
    expect(
      (await requestsFor(ATHLETE_C)).find((r) => r.periodKey === "2026-11-22")!
        .status,
    ).toBe("pending");
    await formPeriodsJob.run(ctx(new Date("2026-11-23T09:15:00Z")));
    expect(
      (await requestsFor(ATHLETE_C)).find((r) => r.periodKey === "2026-11-22")!
        .status,
    ).toBe("missed");
    expect(
      (await eventsOf(COACH_A)).filter((e) => e.kind === "form_missed"),
    ).toHaveLength(1);
  });
});

describe("D7.2 time zones: per-client weekday, archived forms, no clients", () => {
  it("a client's own weekday wins; an archived form or a coach with no clients sends nothing", async () => {
    const form = await makeForm(COACH_A, "Weekly");
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "weekly",
      audience: "all_clients",
      weekday: 7,
      timeLocal: "18:00",
    });
    // E's check-in is Monday 08:00 New York instead of Sunday.
    const setup = await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_E}/forms/${form.id}/setup`,
      COACH_A,
      { status: "active", override: { weekday: 1, timeLocal: "08:00" } },
    );
    expect(setup.status).toBe(200);
    // B coaches only C, and B's form is archived: nothing from B.
    const bForm = await makeForm(COACH_B, "B weekly");
    await makeSchedule(COACH_B, {
      formId: bForm.id,
      trigger: "weekly",
      audience: "all_clients",
      weekday: 7,
      timeLocal: "18:00",
    });
    const archived = await http(
      "DELETE",
      `/trainers/me/forms/${bForm.id}`,
      COACH_B,
    );
    expect(archived.status).toBe(204);
    // A coach with a rule but no clients at all.
    const lonely = randomUUID();
    await db
      .insert(schema.profiles)
      .values({ id: lonely, fullName: "Nia", role: "personal_trainer" });
    const nForm = await makeForm(lonely, "Nobody");
    await makeSchedule(lonely, {
      formId: nForm.id,
      trigger: "daily",
      audience: "all_clients",
      timeLocal: "18:00",
    });
    await tickThrough("2026-11-22T12:00:00Z", "2026-11-23T14:00:00Z");
    expect(await sentAt(ATHLETE_C, "2026-W47")).toBe(
      "2026-11-22T18:00:00.000Z",
    );
    // Monday 08:00 EST is 13:00 UTC, in the next ISO week.
    expect(await sentAt(ATHLETE_E, "2026-W48")).toBe(
      "2026-11-23T13:00:00.000Z",
    );
    expect(
      (await requestsFor(ATHLETE_C)).filter((r) => r.trainerId === COACH_B),
    ).toHaveLength(0);
  });
});

// ─── D7.3 Reminders ──────────────────────────────────────────────────────────

describe("D7.3 reminders", () => {
  async function onceWithReminders(dueAfterHours = 48) {
    const form = await makeForm(COACH_A, "Goals");
    const rule = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
      dueAfterHours,
      reminders: [{ afterHours: 1 }, { afterHours: 2 }],
    });
    const [request] = await requestsFor(ATHLETE_C);
    return { form, rule, request: request! };
  }
  const hoursAfter = (d: Date, h: number) =>
    new Date(d.getTime() + h * 3_600_000 + 60_000);
  const reminders = () =>
    pushesTo(ATHLETE_C).filter((p) => p.input.type === "form_reminder");

  it("announces a new request once, then sends each reminder once while pending, at most N", async () => {
    const { request } = await onceWithReminders();
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 0)));
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 0)));
    const announced = pushesTo(ATHLETE_C).filter(
      (p) => p.input.type === "form_request",
    );
    expect(announced).toHaveLength(1);
    expect(announced[0]!.input).toMatchObject({
      title: "Ellie sent you Goals",
      relatedEntityId: request.id,
    });
    // No deep link: a 1.2.0 tap opens Home, never an unknown route.
    expect(announced[0]!.input.data).not.toHaveProperty("deepLink");

    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 1)));
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 1)));
    expect(reminders()).toHaveLength(1);
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 2)));
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 5)));
    expect(reminders()).toHaveLength(2);
    expect(reminders().map((r) => r.input.data)).toMatchObject([
      { reminder: 1 },
      { reminder: 2 },
    ]);
    const [after] = await requestsFor(ATHLETE_C);
    expect(after!.remindersSent).toBe(2);
  });

  it("a client's own reminders win, and the coach's name falls back when it is blank", async () => {
    const { form, request } = await onceWithReminders();
    await db
      .update(schema.profiles)
      .set({ fullName: null })
      .where(eq(schema.profiles.id, COACH_A));
    const setup = await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${form.id}/setup`,
      COACH_A,
      { status: "active", override: { reminders: [{ afterHours: 3 }] } },
    );
    expect(setup.status).toBe(200);
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 2)));
    expect(reminders()).toHaveLength(0);
    expect(
      pushesTo(ATHLETE_C).find((p) => p.input.type === "form_request")!.input
        .title,
    ).toBe("Your coach sent you Goals");
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 3)));
    expect(reminders().map((r) => r.input.message)).toEqual([
      "Your coach is waiting for your answers.",
    ]);
  });

  it("two overlapping runs send each reminder and each missed mark once", async () => {
    const { request } = await onceWithReminders(2);
    const at = hoursAfter(request.sentAt, 1);
    await Promise.all([formPushesJob.run(ctx(at)), formPushesJob.run(ctx(at))]);
    expect(reminders()).toHaveLength(1);
    const later = hoursAfter(request.sentAt, 3);
    const runs = await Promise.all([
      missedFormsJob.run(ctx(later)),
      missedFormsJob.run(ctx(later)),
    ]);
    expect(runs.map((r) => r.missed).sort()).toEqual([0, 1]);
    expect(
      (await eventsOf(COACH_A)).filter((e) => e.kind === "form_missed"),
    ).toHaveLength(1);
  });

  it("only requests with a reminder due use the page, so old waiting rows never starve newer ones", async () => {
    // Inspector Brad, #548: a page of rows still waiting on a later reminder
    // filled the LIMIT every tick.
    const form = await makeForm(COACH_A, "Goals");
    const rule = await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "all_clients",
      reminders: [{ afterHours: 1 }, { afterHours: 720 }],
    });
    const [older, newer] = (
      await db
        .select()
        .from(schema.coachFormRequests)
        .where(eq(schema.coachFormRequests.scheduleId, rule.id))
    ).sort((a, b) => a.clientId.localeCompare(b.clientId));
    // The older one has had its first reminder and waits 30 days for the next.
    await db
      .update(schema.coachFormRequests)
      .set({
        sentAt: new Date(older!.sentAt.getTime() - 3_600_000 * 5),
        remindersSent: 1,
      })
      .where(eq(schema.coachFormRequests.id, older!.id));
    const at = hoursAfter(newer!.sentAt, 1);
    const page = await reminderCandidates(at, 1);
    expect(page.map((r) => r.id)).toEqual([newer!.id]);
  });

  it("a missed exit form stays in the coach's feed after coaching ends", async () => {
    // Inspector Brad, #548: it was pushed but hidden from the feed and Today.
    const form = await makeForm(COACH_A, "Exit survey");
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "on_end",
      audience: "all_clients",
      dueAfterHours: 1,
    });
    const { endCoachClientRelationship } =
      await import("../../../relationships/endCoachClientRelationship");
    await endCoachClientRelationship({
      trainerId: COACH_A,
      clientId: ATHLETE_C,
      initiatedBy: "client",
    });
    const [exit] = (await requestsFor(ATHLETE_C)).filter(
      (r) => r.trigger === "on_end",
    );
    await missedFormsJob.run(ctx(hoursAfter(exit!.sentAt, 2)));
    expect(pushesTo(COACH_A).map((p) => p.input.title)).toEqual([
      "Chris missed Exit survey",
    ]);
    const feed = await http("GET", "/trainers/me/notifications", COACH_A);
    expect(feed.json.data.map((e: Json) => e.kind)).toEqual(["form_missed"]);
    const since = await http(
      "GET",
      `/trainers/me/notifications?since=${encodeURIComponent("2020-01-01T00:00:00Z")}`,
      COACH_A,
    );
    expect(since.json.deletedIds).toEqual([]);
    // But Today offers no action for a client who has left (Inspector Brad, #548).
    const today = await http("GET", "/trainers/me/today", COACH_A);
    expect(today.json.data.queue).toEqual([]);
    expect(today.json.data.counts.total).toBe(0);
  });

  it("ignores malformed reminders", () => {
    expect(reminderList("nope")).toEqual([]);
    expect(
      reminderList([
        { afterHours: 5 },
        null,
        { afterHours: "x" },
        { afterHours: 2 },
      ]),
    ).toEqual([{ afterHours: 2 }, { afterHours: 5 }]);
  });

  it("sends one reminder, not a burst, when several fell due while the job was down", async () => {
    const { request } = await onceWithReminders();
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 3)));
    expect(reminders()).toHaveLength(1);
    expect((await requestsFor(ATHLETE_C))[0]!.remindersSent).toBe(2);
  });

  it("sends none while the client or the rule is paused, and stop cancels the pending request", async () => {
    const { form, rule, request } = await onceWithReminders();
    const paused = await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${form.id}/setup`,
      COACH_A,
      { status: "paused" },
    );
    expect(paused.status).toBe(200);
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 1)));
    expect(reminders()).toHaveLength(0);

    await http(
      "PUT",
      `/trainers/me/clients/${ATHLETE_C}/forms/${form.id}/setup`,
      COACH_A,
      { status: "active" },
    );
    const rulePaused = await http(
      "PATCH",
      `/trainers/me/form-schedules/${rule.id}`,
      COACH_A,
      { status: "paused" },
    );
    expect(rulePaused.status).toBe(200);
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 1)));
    expect(reminders()).toHaveLength(0);

    const stopped = await http(
      "PATCH",
      `/trainers/me/form-schedules/${rule.id}`,
      COACH_A,
      { status: "stopped" },
    );
    expect(stopped.status).toBe(200);
    expect((await requestsFor(ATHLETE_C))[0]!.status).toBe("cancelled");
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 2)));
    expect(reminders()).toHaveLength(0);
  });

  it("sends none once the form is answered", async () => {
    const { request } = await onceWithReminders();
    const res = await http(
      "POST",
      `/users/me/form-requests/${request.id}/response`,
      ATHLETE_C,
      { answers: { q1: "Good" } },
    );
    expect(res.status).toBe(201);
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 2)));
    expect(reminders()).toHaveLength(0);
  });

  it("marks an overdue request missed once, tells the coach, and stops its reminders", async () => {
    const { request } = await onceWithReminders(1);
    const later = hoursAfter(request.sentAt, 1.5);
    expect(await missedFormsJob.run(ctx(later))).toEqual({ missed: 1 });
    expect(await missedFormsJob.run(ctx(later))).toEqual({ missed: 0 });
    expect((await requestsFor(ATHLETE_C))[0]!.status).toBe("missed");
    const missed = (await eventsOf(COACH_A)).filter(
      (e) => e.kind === "form_missed",
    );
    expect(missed).toHaveLength(1);
    expect(missed[0]!.payload).toMatchObject({ formTitle: "Goals" });
    expect(pushesTo(COACH_A)).toHaveLength(1);
    expect(pushesTo(COACH_A)[0]!.input).toMatchObject({
      type: "coach_event",
      title: "Chris missed Goals",
    });
    await formPushesJob.run(ctx(hoursAfter(request.sentAt, 2)));
    expect(reminders()).toHaveLength(0);
    // Still answerable late (BE-C1's rule), and the coach hears about it.
    const late = await http(
      "POST",
      `/users/me/form-requests/${request.id}/response`,
      ATHLETE_C,
      { answers: { q1: "Sorry" } },
    );
    expect(late.status).toBe(201);
    const done = (await eventsOf(COACH_A)).find(
      (e) => e.kind === "form_completed",
    )!;
    expect(done.payload).toMatchObject({ late: true, trigger: "once" });
  });
});

// ─── D7.7 Events ─────────────────────────────────────────────────────────────

describe("D7.7 events", () => {
  it("a completed session writes one event per active coach with the rating and note", async () => {
    const session = await completedSession(ATHLETE_C, {
      rating: 4,
      difficulty: 7,
      note: "Bench felt heavy",
    });
    await safeRecordWorkoutCompleted(ATHLETE_C, session);
    const a = await eventsOf(COACH_A);
    const b = await eventsOf(COACH_B);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toMatchObject({
      kind: "workout_completed",
      clientId: ATHLETE_C,
      relationshipId: await relationshipId(COACH_A, ATHLETE_C),
      entityId: session,
      payload: {
        sessionId: session,
        workoutName: "Upper B",
        rating: 4,
        difficulty: 7,
        note: "Bench felt heavy",
      },
      // Finished workouts are in-app only by default.
      pushState: "none",
    });
    expect(pushes.list).toHaveLength(0);
    // A replay (or a second completion) writes nothing new: dedupe_key.
    await safeRecordWorkoutCompleted(ATHLETE_C, session);
    expect(await eventsOf(COACH_A)).toHaveLength(1);
    expect(await eventsOf(COACH_B)).toHaveLength(1);
  });

  it("records hit in the session become one record_hit event per coach, pushed", async () => {
    const session = await completedSession(ATHLETE_C, { record: true });
    await safeRecordWorkoutCompleted(ATHLETE_C, session);
    const record = (await eventsOf(COACH_A)).find(
      (e) => e.kind === "record_hit",
    )!;
    expect(record.payload).toMatchObject({
      records: [
        { exerciseName: "Bench", recordType: "max_weight", value: 100 },
      ],
    });
    expect(record.pushState).toBe("sent");
    expect(pushesTo(COACH_A).map((p) => p.input.title)).toEqual([
      "Chris hit a new record",
    ]);
    expect(pushesTo(COACH_B)).toHaveLength(1);
  });

  it("writes nothing for an athlete without a coach, an unfinished session, or one before coaching began", async () => {
    const solo = await completedSession(ATHLETE_G);
    expect(await recordWorkoutCompleted(ATHLETE_G, solo)).toEqual([]);
    const early = await completedSession(ATHLETE_E, {
      completedAt: new Date("2019-06-01T10:00:00Z"),
    });
    await recordWorkoutCompleted(ATHLETE_E, early);
    const open = randomUUID();
    await db.insert(schema.workoutSessions).values({
      id: open,
      userId: ATHLETE_C,
      status: "in_progress",
      startedAt: new Date(),
    });
    expect(await recordWorkoutCompleted(ATHLETE_C, open)).toEqual([]);
    // Someone else's session id reads as nothing.
    expect(await recordWorkoutCompleted(ATHLETE_E, solo)).toEqual([]);
    expect(await db.select().from(schema.coachEvents)).toHaveLength(0);
  });

  it("never fails the session when the event write throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await safeRecordWorkoutCompleted(ATHLETE_C, "not-a-uuid");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a muted client is recorded without a push; everything pushes every kind", async () => {
    await setAlertMode(COACH_A, ATHLETE_C, "mute");
    await setAlertMode(COACH_A, ATHLETE_E, "everything");
    const c = await completedSession(ATHLETE_C, { record: true });
    const e = await completedSession(ATHLETE_E, { note: "Easy" });
    await safeRecordWorkoutCompleted(ATHLETE_C, c);
    await safeRecordWorkoutCompleted(ATHLETE_E, e);
    const events = await eventsOf(COACH_A);
    const forC = events.filter((x) => x.clientId === ATHLETE_C);
    expect(forC.map((x) => x.pushState).sort()).toEqual(["skipped", "skipped"]);
    const forE = events.find((x) => x.clientId === ATHLETE_E)!;
    expect(forE.pushState).toBe("sent");
    expect(pushesTo(COACH_A).map((p) => p.input.title)).toEqual([
      "Lena finished Upper B",
    ]);
    expect(pushesTo(COACH_A)[0]!.input).toMatchObject({
      message: '"Easy"',
      data: {
        deepLink: "persistencemobile://clients",
        kind: "workout_completed",
      },
    });
    // B isn't muted: their record push still goes out.
    expect(pushesTo(COACH_B).map((p) => p.input.title)).toEqual([
      "Chris hit a new record",
    ]);
  });

  it("quiet hours hold pushes and release one per client in the coach's time zone", async () => {
    const put = await http(
      "PUT",
      "/trainers/me/notification-settings",
      COACH_A,
      { quietHours: { enabled: true, from: "22:00", until: "07:00" } },
    );
    expect(put.status).toBe(200);
    const night = new Date("2026-11-23T23:00:00Z");
    const relC = await relationshipId(COACH_A, ATHLETE_C);
    const relE = await relationshipId(COACH_A, ATHLETE_E);
    for (const [i, kind] of (
      ["form_completed", "record_hit", "training_behind"] as const
    ).entries()) {
      const id = await recordCoachEvent(
        realDb(),
        {
          trainerId: COACH_A,
          clientId: ATHLETE_C,
          relationshipId: relC,
          kind,
          payload: { formTitle: "Weekly check-in" },
          dedupeKey: `quiet:${i}`,
        },
        night,
      );
      expect(id).toBeNull();
    }
    await recordCoachEvent(
      realDb(),
      {
        trainerId: COACH_A,
        clientId: ATHLETE_E,
        relationshipId: relE,
        kind: "form_completed",
        payload: { formTitle: "Goals" },
        dedupeKey: "quiet:e",
      },
      night,
    );
    expect((await eventsOf(COACH_A)).every((e) => e.pushState === "held")).toBe(
      true,
    );

    // Still quiet at 06:59 London.
    await coachPushesJob.run(ctx(new Date("2026-11-24T06:59:00Z")));
    expect(pushes.list).toHaveLength(0);
    // The window has ended: one push per client.
    const morning = new Date("2026-11-24T07:00:00Z");
    expect(await coachPushesJob.run(ctx(morning))).toEqual({
      pushed: 0,
      released: 4,
      groups: 2,
    });
    expect(
      pushesTo(COACH_A)
        .map((p) => p.input.title)
        .sort(),
    ).toEqual(["Chris: 3 updates", "Lena completed Goals"]);
    expect((await eventsOf(COACH_A)).every((e) => e.pushState === "sent")).toBe(
      true,
    );
    // Released once.
    await coachPushesJob.run(ctx(morning));
    expect(pushes.list).toHaveLength(2);
  });

  it("quiet hours follow the coach's own zone (New York)", async () => {
    await db
      .update(schema.profiles)
      .set({ timezone: "America/New_York" })
      .where(eq(schema.profiles.id, COACH_A));
    await http("PUT", "/trainers/me/notification-settings", COACH_A, {
      quietHours: { enabled: true, from: "22:00", until: "07:00" },
    });
    // 04:00 UTC is 23:00 in New York: quiet.
    await recordCoachEvent(
      realDb(),
      {
        trainerId: COACH_A,
        clientId: ATHLETE_E,
        relationshipId: await relationshipId(COACH_A, ATHLETE_E),
        kind: "form_missed",
        payload: { formTitle: "Goals" },
        dedupeKey: "ny",
      },
      new Date("2026-11-24T04:00:00Z"),
    );
    // 07:30 UTC is morning in London but 02:30 in New York: still held.
    await coachPushesJob.run(ctx(new Date("2026-11-24T07:30:00Z")));
    expect(pushes.list).toHaveLength(0);
    await coachPushesJob.run(ctx(new Date("2026-11-24T12:00:00Z")));
    expect(pushesTo(COACH_A).map((p) => p.input.title)).toEqual([
      "Lena missed Goals",
    ]);
  });

  it("dedupe_key stops duplicates, and a pending push is sent once however many callers race", async () => {
    const input = {
      trainerId: COACH_A,
      clientId: ATHLETE_C,
      relationshipId: await relationshipId(COACH_A, ATHLETE_C),
      kind: "form_completed" as const,
      payload: { formTitle: "Goals" },
      dedupeKey: "form_completed:x",
    };
    const first = await recordCoachEvent(realDb(), input);
    const second = await recordCoachEvent(realDb(), input);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await eventsOf(COACH_A)).toHaveLength(1);
    await Promise.all([
      deliverCoachEvents([first!]),
      deliverCoachEvents([first!]),
    ]);
    expect(pushesTo(COACH_A)).toHaveLength(1);
    await expect(
      recordCoachEvent(realDb(), { ...input, kind: "nope" as never }),
    ).rejects.toThrow("unknown coach event kind");
  });

  it("a pending event swept during quiet hours that began after it was written is held, not pushed", async () => {
    // Inspector Brad, #548: written at 21:58, swept at 22:05 inside quiet hours.
    await http("PUT", "/trainers/me/notification-settings", COACH_A, {
      quietHours: { enabled: true, from: "22:00", until: "07:00" },
    });
    const id = await recordCoachEvent(
      realDb(),
      {
        trainerId: COACH_A,
        clientId: ATHLETE_C,
        relationshipId: await relationshipId(COACH_A, ATHLETE_C),
        kind: "client_accepted",
        dedupeKey: "late",
      },
      new Date("2026-11-23T21:58:00Z"),
    );
    expect(id).not.toBeNull();
    await db
      .update(schema.coachEvents)
      .set({ createdAt: new Date("2026-11-23T21:58:00Z") })
      .where(eq(schema.coachEvents.id, id!));
    await coachPushesJob.run(ctx(new Date("2026-11-23T22:05:00Z")));
    expect(pushes.list).toHaveLength(0);
    const [event] = await eventsOf(COACH_A);
    expect(event!.pushState).toBe("held");
    await coachPushesJob.run(ctx(new Date("2026-11-24T07:00:00Z")));
    expect(pushesTo(COACH_A).map((p) => p.input.title)).toEqual([
      "Chris accepted your invite",
    ]);
  });

  it("a pending event left behind is pushed by the next tick", async () => {
    await recordCoachEvent(
      realDb(),
      {
        trainerId: COACH_A,
        clientId: ATHLETE_C,
        relationshipId: await relationshipId(COACH_A, ATHLETE_C),
        kind: "form_completed",
        payload: { formTitle: "Goals" },
        dedupeKey: "left",
      },
      new Date("2026-11-23T10:00:00Z"),
    );
    // Written moments ago: left for its own writer.
    await db
      .update(schema.coachEvents)
      .set({ createdAt: new Date() })
      .where(eq(schema.coachEvents.dedupeKey, "left"));
    expect(
      await coachPushesJob.run(ctx(new Date(Date.now() + 10_000))),
    ).toMatchObject({ pushed: 0 });
    expect(
      await coachPushesJob.run(ctx(new Date(Date.now() + 120_000))),
    ).toMatchObject({ pushed: 1 });
  });

  it("answering a form tells the coach once; a recurring check-in is check_in_completed", async () => {
    const form = await makeForm(COACH_A, "Goals");
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
    });
    const [request] = await requestsFor(ATHLETE_C);
    const body = { answers: { q1: "Lose 5kg" } };
    const res = await app.handle(
      new Request(
        `http://localhost/users/me/form-requests/${request!.id}/response`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${ATHLETE_C}`,
            "content-type": "application/json",
            "idempotency-key": "k1",
          },
          body: JSON.stringify(body),
        },
      ),
    );
    expect(res.status).toBe(201);
    const replay = await app.handle(
      new Request(
        `http://localhost/users/me/form-requests/${request!.id}/response`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${ATHLETE_C}`,
            "content-type": "application/json",
            "idempotency-key": "k1",
          },
          body: JSON.stringify(body),
        },
      ),
    );
    // BE-C1 replays the stored response with the same status.
    expect(replay.status).toBe(201);
    const done = (await eventsOf(COACH_A)).filter(
      (e) => e.kind === "form_completed",
    );
    expect(done).toHaveLength(1);
    expect(done[0]!.payload).toMatchObject({
      formTitle: "Goals",
      trigger: "once",
      late: false,
    });
    expect(pushesTo(COACH_A).map((p) => p.input.title)).toEqual([
      "Chris completed Goals",
    ]);
    // B, who also coaches C, hears nothing about A's form.
    expect(await eventsOf(COACH_B)).toHaveLength(0);

    const weekly = await makeForm(COACH_A, "Weekly");
    await makeSchedule(COACH_A, {
      formId: weekly.id,
      trigger: "weekly",
      audience: "selected",
      clientIds: [ATHLETE_C],
      weekday: 1,
      timeLocal: "09:00",
    });
    await formPeriodsJob.run(ctx(new Date("2026-11-23T09:00:00Z")));
    const wk = (await requestsFor(ATHLETE_C)).find(
      (r) => r.trigger === "weekly",
    )!;
    const answered = await http(
      "POST",
      `/users/me/form-requests/${wk.id}/response`,
      ATHLETE_C,
      { answers: { q1: "Fine" } },
    );
    expect(answered.status).toBe(201);
    expect(
      (await eventsOf(COACH_A)).filter((e) => e.kind === "check_in_completed"),
    ).toHaveLength(1);
  });

  it("an athlete accepting a coach's request writes client_accepted once; personal-code accepts don't push twice", async () => {
    const rel = randomUUID();
    await db.insert(schema.ptClientRelationships).values({
      id: rel,
      trainerId: COACH_B,
      clientId: ATHLETE_G,
      status: "pending",
    });
    const res = await http(
      "POST",
      `/clients/me/relationships/${rel}/respond`,
      ATHLETE_G,
      { action: "accept", consent: true, consentVersion: "v1-2026-07" },
    );
    expect(res.status).toBe(200);
    const accepted = (await eventsOf(COACH_B)).filter(
      (e) => e.kind === "client_accepted",
    );
    expect(accepted).toHaveLength(1);
    // Pushed by the next tick.
    expect(accepted[0]!.pushState).toBe("pending");
    await db
      .update(schema.coachEvents)
      .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(schema.coachEvents.id, accepted[0]!.id));
    await coachPushesJob.run(ctx(new Date()));
    expect(pushesTo(COACH_B).map((p) => p.input.title)).toEqual([
      "Gus accepted your invite",
    ]);

    // The personal-code path already pushes "Client accepted" itself.
    const relA = await relationshipId(COACH_A, ATHLETE_C);
    await recordClientAccepted(
      realDb(),
      { trainerId: COACH_A, clientId: ATHLETE_C, relationshipId: relA },
      { noPush: true },
    );
    await recordClientAccepted(
      realDb(),
      { trainerId: COACH_A, clientId: ATHLETE_C, relationshipId: relA },
      { noPush: true },
    );
    const forA = (await eventsOf(COACH_A)).filter(
      (e) => e.kind === "client_accepted",
    );
    expect(forA).toHaveLength(1);
    expect(forA[0]!.pushState).toBe("none");
  });

  it("an email-only or off kind is stored without a push", () => {
    const prefs = {
      channels: { form_completed: "email" as const },
      quietEnabled: false,
      quietFrom: null,
      quietUntil: null,
      timeZone: "Europe/London",
    };
    const now = new Date();
    expect(initialPushState("form_completed", "default", prefs, now)).toBe(
      "none",
    );
    expect(initialPushState("form_completed", "everything", prefs, now)).toBe(
      "pending",
    );
    expect(initialPushState("form_missed", "default", prefs, now)).toBe(
      "pending",
    );
  });

  it("writes push text for every kind", () => {
    expect(pushText("form_completed", "Sam", {}).title).toBe(
      "Sam completed a form",
    );
    expect(pushText("workout_completed", "Sam", { difficulty: 8 }).body).toBe(
      "Difficulty 8/10",
    );
    expect(pushText("workout_completed", "Sam", { rating: 5 }).body).toBe(
      "Rated 5/5",
    );
    expect(pushText("record_hit", "Sam", { records: [1, 2] }).title).toBe(
      "Sam hit 2 new records",
    );
    expect(pushText("form_missed", "Sam", {}).title).toBe("Sam missed a form");
    expect(pushText("client_accepted", "Sam", {}).title).toBe(
      "Sam accepted your invite",
    );
    expect(pushText("invite_expired", "Sam", {}).title).toBe(
      "Sam's invite expired",
    );
    expect(
      pushText("programme_ending", "Sam", { programName: "Block 2" }),
    ).toEqual({ title: "Sam's programme ends soon", body: "Block 2" });
    expect(pushText("training_behind", "Sam", { label: "1 of 3" }).body).toBe(
      "1 of 3",
    );
    expect(pushText("message_received", "Sam", {}).title).toBe(
      "Sam: a new update",
    );
  });
});

// ─── Scheduler checks ────────────────────────────────────────────────────────

describe("scheduler checks", () => {
  it("an invite that expired unaccepted is announced once", async () => {
    const profileId = randomUUID();
    await db.insert(schema.coachClientProfiles).values({
      id: profileId,
      trainerId: COACH_A,
      displayName: "Sam",
      status: "invited",
    });
    const now = new Date("2026-11-23T12:00:00Z");
    const otherProfile = randomUUID();
    await db.insert(schema.coachClientProfiles).values({
      id: otherProfile,
      trainerId: COACH_A,
      displayName: "Ana",
      status: "invited",
    });
    await db.insert(schema.trainerInviteCodes).values([
      {
        trainerId: COACH_A,
        code: "EXPIRED1",
        status: "active",
        expiresAt: new Date("2026-11-23T11:00:00Z"),
        clientProfileId: profileId,
      },
      // Still valid: not announced.
      {
        trainerId: COACH_A,
        code: "VALID001",
        status: "active",
        expiresAt: new Date("2026-11-30T11:00:00Z"),
        clientProfileId: otherProfile,
      },
    ]);
    expect(await inviteExpiryJob.run(ctx(now))).toEqual({
      checked: 1,
      events: 1,
    });
    // Already announced: it no longer even comes back from the query.
    expect(await inviteExpiryJob.run(ctx(now))).toEqual({
      checked: 0,
      events: 0,
    });
    const [event] = await eventsOf(COACH_A);
    expect(event).toMatchObject({
      kind: "invite_expired",
      clientId: null,
      entityId: profileId,
      payload: { displayName: "Sam" },
    });
    expect(pushesTo(COACH_A).map((p) => p.input.title)).toEqual([
      "Sam's invite expired",
    ]);
  });

  it("a programme ending within 7 days is raised once, only for the coach who assigned it", async () => {
    const program = randomUUID();
    await db.insert(schema.workoutPrograms).values({
      id: program,
      name: "Block 2",
    } as typeof schema.workoutPrograms.$inferInsert);
    await db.insert(schema.programAssignments).values([
      {
        programId: program,
        clientId: ATHLETE_C,
        assignedBy: COACH_A,
        startDate: "2026-10-01",
        endDate: "2026-11-27",
        status: "started",
      },
      // Too far away.
      {
        programId: randomUUID(),
        clientId: ATHLETE_E,
        assignedBy: COACH_A,
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        status: "assigned",
      },
    ]);
    const now = new Date("2026-11-23T09:00:00Z");
    expect(await programmeEndingJob.run(ctx(now))).toEqual({
      checked: 1,
      events: 1,
    });
    await programmeEndingJob.run(ctx(now));
    expect(await eventsOf(COACH_A)).toHaveLength(1);
    expect((await eventsOf(COACH_A))[0]!.payload).toMatchObject({
      programName: "Block 2",
      endDate: "2026-11-27",
    });
    expect(await eventsOf(COACH_B)).toHaveLength(0);
  });

  it("training behind judges complete days only: a weekly Tuesday-evening client isn't behind on Tuesday morning", async () => {
    // Inspector Brad, #548: at 08:00 UTC "today" has barely started, so a
    // window that includes it drops last Tuesday and flags an on-track client.
    await setAlertMode(COACH_A, ATHLETE_C, "default", {
      trackTraining: true,
      sessionsPerWeek: 1,
    });
    await completedSession(ATHLETE_C, {
      completedAt: new Date("2026-11-17T19:00:00Z"),
    });
    // New York: Tuesday 03:00 local when the job runs.
    await setAlertMode(COACH_A, ATHLETE_E, "default", {
      trackTraining: true,
      sessionsPerWeek: 1,
    });
    await completedSession(ATHLETE_E, {
      completedAt: new Date("2026-11-17T23:30:00Z"),
    });
    const tuesdayMorning = new Date("2026-11-24T08:00:00Z");
    expect(await trainingBehindJob.run(ctx(tuesdayMorning))).toMatchObject({
      behind: 0,
    });
    // A week later with nothing logged since, both are behind.
    expect(
      await trainingBehindJob.run(ctx(new Date("2026-12-01T08:00:00Z"))),
    ).toMatchObject({ behind: 2 });
  });

  it("training behind uses the shared adherence calculation, at most once per client per 7 days", async () => {
    // C: 3 a week, none done → behind. E: 1 a week, 1 done → met.
    await setAlertMode(COACH_A, ATHLETE_C, "default", {
      trackTraining: true,
      sessionsPerWeek: 3,
    });
    await setAlertMode(COACH_A, ATHLETE_E, "default", {
      trackTraining: true,
      sessionsPerWeek: 1,
    });
    const now = new Date("2026-11-23T09:00:00Z");
    await completedSession(ATHLETE_E, {
      completedAt: new Date("2026-11-22T15:00:00Z"),
    });
    expect(await trainingBehindJob.run(ctx(now))).toEqual({
      trainers: 1,
      behind: 1,
      events: 1,
    });
    const [event] = await eventsOf(COACH_A);
    expect(event).toMatchObject({
      kind: "training_behind",
      clientId: ATHLETE_C,
      payload: { done: 0, target: 3 },
    });
    // Next day: still behind, not raised again.
    const tomorrow = new Date("2026-11-24T09:00:00Z");
    await trainingBehindJob.run(ctx(tomorrow));
    expect(await eventsOf(COACH_A)).toHaveLength(1);
    // A client in their first week isn't behind on days before they joined.
    await db
      .update(schema.ptClientRelationships)
      .set({ activatedAt: new Date("2026-11-30T08:00:00Z") })
      .where(
        eq(
          schema.ptClientRelationships.id,
          await relationshipId(COACH_A, ATHLETE_C),
        ),
      );
    await trainingBehindJob.run(ctx(new Date("2026-12-02T09:00:00Z")));
    const forC = (await eventsOf(COACH_A)).filter(
      (e) => e.clientId === ATHLETE_C,
    );
    expect(forC).toHaveLength(1);
  });
});

// ─── The scheduler runner ────────────────────────────────────────────────────

describe("coachSchedulerCron", () => {
  const counting = (name: string, cadence: "tick" | "daily") => {
    const job: SchedulerJob & { runs: number } = {
      name,
      cadence,
      runs: 0,
      async run() {
        job.runs += 1;
        return { n: job.runs };
      },
    };
    return job;
  };

  it("runs a tick once: the same 15-minute slot run twice changes nothing", async () => {
    const tick = counting("t", "tick");
    const daily = counting("d", "daily");
    const at = new Date("2026-11-23T09:07:00Z");
    const first = await runCoachScheduler([tick, daily], ctx(at));
    expect(first.tick).toBe("2026-11-23T09:00");
    expect(first.jobs.t).toEqual({ status: "ran", summary: { n: 1 } });
    const again = await runCoachScheduler(
      [tick, daily],
      ctx(new Date("2026-11-23T09:14:59Z")),
    );
    expect(again.jobs.t).toEqual({ status: "skipped", reason: "already_ran" });
    expect(again.jobs.d).toEqual({ status: "skipped", reason: "already_ran" });
    // The next slot runs the tick job, not the daily one.
    await runCoachScheduler(
      [tick, daily],
      ctx(new Date("2026-11-23T09:15:00Z")),
    );
    expect([tick.runs, daily.runs]).toEqual([2, 1]);
  });

  it("waits for the morning for daily jobs", async () => {
    const daily = counting("d", "daily");
    const early = await runCoachScheduler(
      [daily],
      ctx(new Date("2026-11-23T06:00:00Z")),
    );
    expect(early.jobs.d).toEqual({ status: "skipped", reason: "not_due" });
  });

  it("gives a failed job's claim back so the next run retries it, and keeps going", async () => {
    let fail = true;
    const flaky: SchedulerJob = {
      name: "flaky",
      cadence: "tick",
      async run() {
        if (fail) throw new Error("boom");
        return {};
      },
    };
    const after = counting("after", "tick");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const at = new Date("2026-11-23T09:00:00Z");
    const result = await runCoachScheduler([flaky, after], ctx(at));
    expect(result.jobs.flaky).toEqual({ status: "failed", error: "boom" });
    expect(after.runs).toBe(1);
    fail = false;
    const retry = await runCoachScheduler([flaky, after], ctx(at));
    expect(retry.jobs.flaky).toEqual({ status: "ran", summary: {} });
    spy.mockRestore();
  });

  it("reports a non-Error failure, and builds its own context", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const odd: SchedulerJob = {
      name: "odd",
      cadence: "tick",
      async run() {
        throw "plain string";
      },
    };
    const result = await runCoachScheduler(
      [odd],
      ctx(new Date("2026-11-23T10:00:00Z")),
    );
    expect(result.jobs.odd).toEqual({
      status: "failed",
      error: "plain string",
    });
    spy.mockRestore();
    const own = defaultContext(new Date("2026-11-23T10:00:00Z"));
    expect(own.now.toISOString()).toBe("2026-11-23T10:00:00.000Z");
    expect(own.dispatcher).toBeInstanceOf(NotificationDispatcher);
    expect(defaultContext().now).toBeInstanceOf(Date);
  });

  it("drops claims older than 30 days", async () => {
    await db.insert(schema.coachSchedulerRuns).values({
      job: "old",
      runKey: "2026-01-01T00:00",
      ranAt: new Date("2026-01-01T00:00:00Z"),
    });
    await runCoachScheduler([], ctx(new Date("2026-11-23T09:00:00Z")));
    expect(await db.select().from(schema.coachSchedulerRuns)).toHaveLength(0);
  });

  it("the real job list runs end to end twice in one slot without changing anything the second time", async () => {
    const form = await makeForm(COACH_A, "Daily");
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "daily",
      audience: "all_clients",
      timeLocal: "09:00",
      reminders: [{ afterHours: 1 }],
    });
    const now = new Date("2026-11-23T09:00:00Z");
    const first = await runCoachScheduler(COACH_SCHEDULER_JOBS, ctx(now));
    expect(Object.values(first.jobs).every((j) => j.status === "ran")).toBe(
      true,
    );
    expect(first.jobs.form_periods).toMatchObject({
      summary: { sent: 1 },
    });
    expect(first.jobs.form_pushes).toMatchObject({
      summary: { announced: 1 },
    });
    const snapshot = async () => ({
      requests: (await db.select().from(schema.coachFormRequests)).length,
      notifications: (await db.select().from(schema.notifications)).length,
      events: (await db.select().from(schema.coachEvents)).length,
    });
    const before = await snapshot();
    const second = await runCoachScheduler(COACH_SCHEDULER_JOBS, ctx(now));
    expect(
      Object.values(second.jobs).every((j) => j.status === "skipped"),
    ).toBe(true);
    // Even run directly (no claim), every job is idempotent on its data.
    for (const job of COACH_SCHEDULER_JOBS) await job.run(ctx(now));
    expect(await snapshot()).toEqual(before);
    expect(tickKey(now)).toBe("2026-11-23T09:00");
  });
});

// ─── Routes, Today and isolation ─────────────────────────────────────────────

async function seedFeed() {
  const relC = await relationshipId(COACH_A, ATHLETE_C);
  const relE = await relationshipId(COACH_A, ATHLETE_E);
  const relBC = await relationshipId(COACH_B, ATHLETE_C);
  const at = (m: number) => new Date(Date.UTC(2026, 10, 23, 8, m));
  const mk = (
    trainerId: string,
    clientId: string,
    rel: string,
    kind: Parameters<typeof recordCoachEvent>[1]["kind"],
    m: number,
  ) =>
    recordCoachEvent(realDb(), {
      trainerId,
      clientId,
      relationshipId: rel,
      kind,
      payload: { formTitle: "Weekly" },
      occurredAt: at(m),
      dedupeKey: `${kind}:${clientId}:${m}`,
    });
  await mk(COACH_A, ATHLETE_C, relC, "form_completed", 1);
  await mk(COACH_A, ATHLETE_C, relC, "workout_completed", 2);
  await mk(COACH_A, ATHLETE_E, relE, "form_missed", 3);
  await mk(COACH_A, ATHLETE_E, relE, "record_hit", 4);
  await mk(COACH_B, ATHLETE_C, relBC, "check_in_completed", 5);
}

describe("notifications feed", () => {
  it("lists the caller's events newest first, filters, pages and counts unread", async () => {
    await seedFeed();
    const all = await http("GET", "/trainers/me/notifications", COACH_A);
    expect(all.status).toBe(200);
    expect(all.json.data.map((e: Json) => e.kind)).toEqual([
      "record_hit",
      "form_missed",
      "workout_completed",
      "form_completed",
    ]);
    expect(all.json.unreadCount).toBe(4);
    expect(all.json.nextCursor).toBeNull();
    expect(typeof all.json.asOf).toBe("string");
    expect(all.json.data[0]).toMatchObject({
      client: { id: ATHLETE_E, name: "Lena" },
      actionable: false,
      readAt: null,
    });
    expect(all.json.data[1].actionable).toBe(true);

    const page1 = await http(
      "GET",
      "/trainers/me/notifications?limit=3",
      COACH_A,
    );
    expect(page1.json.data).toHaveLength(3);
    const page2 = await http(
      "GET",
      `/trainers/me/notifications?limit=3&cursor=${page1.json.nextCursor}`,
      COACH_A,
    );
    expect(page2.json.data.map((e: Json) => e.kind)).toEqual([
      "form_completed",
    ]);
    expect(page2.json.nextCursor).toBeNull();

    const kinds = await http(
      "GET",
      "/trainers/me/notifications?kind=form_completed,form_missed",
      COACH_A,
    );
    expect(kinds.json.data).toHaveLength(2);
    const forC = await http(
      "GET",
      `/trainers/me/notifications?clientId=${ATHLETE_C}`,
      COACH_A,
    );
    expect(forC.json.data).toHaveLength(2);
  });

  it("rejects a bad kind, since or cursor", async () => {
    for (const q of ["kind=nope", "since=yesterday", "cursor=!!!"]) {
      const res = await http("GET", `/trainers/me/notifications?${q}`, COACH_A);
      expect([q, res.status]).toEqual([q, 400]);
    }
    expect(
      decodeCursor(Buffer.from("2026-01-01|nope").toString("base64url")),
    ).toBeNull();
  });

  it("read marks are idempotent: by id or everything", async () => {
    await seedFeed();
    const feed = await http("GET", "/trainers/me/notifications", COACH_A);
    const id = feed.json.data[0].id;
    const first = await http(
      "POST",
      "/trainers/me/notifications/read",
      COACH_A,
      {
        ids: [id],
      },
    );
    expect(first.json.data).toEqual({ updated: 1 });
    const again = await http(
      "POST",
      "/trainers/me/notifications/read",
      COACH_A,
      {
        ids: [id],
      },
    );
    expect(again.json.data).toEqual({ updated: 0 });
    const all = await http("POST", "/trainers/me/notifications/read", COACH_A, {
      all: true,
    });
    expect(all.json.data).toEqual({ updated: 3 });
    const none = await http(
      "POST",
      "/trainers/me/notifications/read",
      COACH_A,
      {},
    );
    expect(none.status).toBe(400);
    const after = await http("GET", "/trainers/me/notifications", COACH_A);
    expect(after.json.unreadCount).toBe(0);
    // `since` reports what changed after a moment.
    const since = await http(
      "GET",
      `/trainers/me/notifications?since=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`,
      COACH_A,
    );
    expect(since.json.data).toHaveLength(4);
    expect(since.json.deletedIds).toEqual([]);
  });

  it("hides a client's events once coaching ends (reported in deletedIds), but keeps an exit form's response", async () => {
    await seedFeed();
    const relC = await relationshipId(COACH_A, ATHLETE_C);
    await recordCoachEvent(realDb(), {
      trainerId: COACH_A,
      clientId: ATHLETE_C,
      relationshipId: relC,
      kind: "form_completed",
      payload: { formTitle: "Exit", trigger: "on_end" },
      dedupeKey: "exit",
    });
    const before = new Date(Date.now() - 1000).toISOString();
    await db
      .update(schema.ptClientRelationships)
      .set({ status: "terminated", updatedAt: new Date() })
      .where(eq(schema.ptClientRelationships.id, relC));
    const feed = await http("GET", "/trainers/me/notifications", COACH_A);
    expect(
      feed.json.data.map((e: Json) => [e.client?.name, e.payload.formTitle]),
    ).toEqual([
      ["Chris", "Exit"],
      ["Lena", "Weekly"],
      ["Lena", "Weekly"],
    ]);
    const since = await http(
      "GET",
      `/trainers/me/notifications?since=${encodeURIComponent(before)}`,
      COACH_A,
    );
    expect(since.json.deletedIds).toHaveLength(2);
    // Filtering by an ended client goes through resolveCoachScope → 403.
    const filtered = await http(
      "GET",
      `/trainers/me/notifications?clientId=${ATHLETE_C}`,
      COACH_A,
    );
    expect(filtered.status).toBe(403);
  });
});

describe("Today", () => {
  it("queues only actionable, unactioned items with counts, schedule and the adherence strip", async () => {
    await seedFeed();
    await setAlertMode(COACH_A, ATHLETE_C, "default", {
      trackTraining: true,
      sessionsPerWeek: 2,
    });
    const today = await http("GET", "/trainers/me/today", COACH_A);
    expect(today.status).toBe(200);
    expect(today.json.data.queue.map((i: Json) => [i.kind, i.action])).toEqual([
      ["form_missed", "nudge_client"],
      ["form_completed", "review_response"],
    ]);
    expect(today.json.data.queue[0]).toMatchObject({
      client: { id: ATHLETE_E, name: "Lena" },
      facts: { formTitle: "Weekly" },
    });
    expect(today.json.data.counts).toEqual({
      total: 2,
      byKind: { form_missed: 1, form_completed: 1 },
    });
    expect(today.json.data.schedule).toEqual([]);
    expect(today.json.data.strip.training).toMatchObject({
      done: 0,
      target: 2,
      clients: 1,
    });

    const eventId = today.json.data.queue[0].eventId;
    const done = await http(
      "POST",
      `/trainers/me/today/${eventId}/actioned`,
      COACH_A,
    );
    expect(done.status).toBe(200);
    const again = await http(
      "POST",
      `/trainers/me/today/${eventId}/actioned`,
      COACH_A,
    );
    expect(again.json.data).toEqual(done.json.data);
    const after = await http("GET", "/trainers/me/today", COACH_A);
    expect(after.json.data.counts.total).toBe(1);
    // Actioning also marks it read.
    const feed = await http("GET", "/trainers/me/notifications", COACH_A);
    expect(feed.json.data.find((e: Json) => e.id === eventId).readAt).not.toBe(
      null,
    );
    const missing = await http(
      "POST",
      `/trainers/me/today/${randomUUID()}/actioned`,
      COACH_A,
    );
    expect(missing.status).toBe(404);
  });
});

describe("two-coach isolation", () => {
  it("coach B never sees coach A's events or Today items, even for a shared athlete", async () => {
    await seedFeed();
    const feedB = await http("GET", "/trainers/me/notifications", COACH_B);
    expect(feedB.json.data.map((e: Json) => e.kind)).toEqual([
      "check_in_completed",
    ]);
    expect(feedB.json.unreadCount).toBe(1);
    const todayB = await http("GET", "/trainers/me/today", COACH_B);
    expect(todayB.json.data.queue.map((i: Json) => i.kind)).toEqual([
      "check_in_completed",
    ]);
    // Shared athlete C: B's filter shows only B's own event.
    const sharedB = await http(
      "GET",
      `/trainers/me/notifications?clientId=${ATHLETE_C}`,
      COACH_B,
    );
    expect(sharedB.json.data).toHaveLength(1);
    // A's client E: not B's client.
    const notMine = await http(
      "GET",
      `/trainers/me/notifications?clientId=${ATHLETE_E}`,
      COACH_B,
    );
    expect(notMine.status).toBe(403);
    // B can't action or read A's events.
    const aEvent = (await eventsOf(COACH_A))[0]!;
    const action = await http(
      "POST",
      `/trainers/me/today/${aEvent.id}/actioned`,
      COACH_B,
    );
    expect(action.status).toBe(404);
    await http("POST", "/trainers/me/notifications/read", COACH_B, {
      ids: [aEvent.id],
    });
    await http("POST", "/trainers/me/notifications/read", COACH_B, {
      all: true,
    });
    expect(
      (await eventsOf(COACH_A)).every(
        (e) => e.readAt === null && e.actionedAt === null,
      ),
    ).toBe(true);
    // Settings are per coach.
    await http("PUT", "/trainers/me/notification-settings", COACH_A, {
      channels: { workout_completed: "push" },
    });
    const settingsB = await http(
      "GET",
      "/trainers/me/notification-settings",
      COACH_B,
    );
    expect(settingsB.json.data.channels.workout_completed).toBe("off");
  });

  it("an athlete gets 403 on every coach route", async () => {
    for (const [method, path] of [
      ["GET", "/trainers/me/notifications"],
      ["POST", "/trainers/me/notifications/read"],
      ["GET", "/trainers/me/today"],
      ["POST", `/trainers/me/today/${randomUUID()}/actioned`],
      ["GET", "/trainers/me/notification-settings"],
      ["PUT", "/trainers/me/notification-settings"],
    ] as const) {
      const res = await http(
        method,
        path,
        ATHLETE_C,
        method === "GET" ? undefined : {},
      );
      expect([path, res.status]).toEqual([path, 403]);
    }
    const anon = await http("GET", "/trainers/me/today", null);
    expect(anon.status).toBe(401);
  });
});

describe("notification settings (C6)", () => {
  it("returns defaults with email hidden, saves, merges and checks the revision", async () => {
    const first = await http(
      "GET",
      "/trainers/me/notification-settings",
      COACH_A,
    );
    expect(first.json.data).toMatchObject({
      emailAvailable: false,
      revision: 0,
      updatedAt: null,
      timeZone: "Europe/London",
      quietHours: { enabled: false, from: null, until: null },
      channels: { workout_completed: "off", form_completed: "push" },
    });
    expect(Object.keys(first.json.data.channels)).toHaveLength(11);

    const saved = await http(
      "PUT",
      "/trainers/me/notification-settings",
      COACH_A,
      {
        channels: { workout_completed: "push", form_missed: "email" },
        expectedRevision: 0,
      },
    );
    expect(saved.status).toBe(200);
    expect(saved.json.data).toMatchObject({
      revision: 1,
      channels: { workout_completed: "push", form_missed: "email" },
    });
    // Channels merge; quiet hours replace.
    const quiet = await http(
      "PUT",
      "/trainers/me/notification-settings",
      COACH_A,
      {
        channels: { record_hit: "off" },
        quietHours: { enabled: true, from: "21:30", until: "06:45" },
        expectedRevision: 1,
      },
    );
    expect(quiet.json.data).toMatchObject({
      revision: 2,
      channels: {
        workout_completed: "push",
        form_missed: "email",
        record_hit: "off",
      },
      quietHours: { enabled: true, from: "21:30", until: "06:45" },
    });
    // A PUT without quiet hours keeps them; without expectedRevision, last
    // write wins (older apps).
    const keep = await http(
      "PUT",
      "/trainers/me/notification-settings",
      COACH_A,
      {
        channels: {},
      },
    );
    expect(keep.json.data.quietHours.enabled).toBe(true);
    expect(keep.json.data.revision).toBe(3);

    const stale = await http(
      "PUT",
      "/trainers/me/notification-settings",
      COACH_A,
      {
        channels: { record_hit: "push" },
        expectedRevision: 1,
      },
    );
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({
      code: "revision_conflict",
      current: { revision: 3, channels: { record_hit: "off" } },
    });
    const firstSaveStale = await http(
      "PUT",
      "/trainers/me/notification-settings",
      COACH_B,
      { channels: {}, expectedRevision: 4 },
    );
    expect(firstSaveStale.status).toBe(409);
  });

  it("rejects unknown kinds, channels and bad quiet hours", async () => {
    for (const body of [
      { channels: { nope: "push" } },
      { channels: { form_completed: "sms" } },
      { quietHours: { enabled: true, from: "25:00", until: "07:00" } },
      { quietHours: { enabled: true, from: "22:00" } },
      { quietHours: { enabled: true, from: "22:00", until: "22:00" } },
    ]) {
      const res = await http(
        "PUT",
        "/trainers/me/notification-settings",
        COACH_A,
        body,
      );
      expect([body, res.status, res.json.code]).toEqual([
        body,
        400,
        "invalid_settings",
      ]);
    }
  });
});

// ─── D7.9 Contract ───────────────────────────────────────────────────────────

describe("D7.9 contract", () => {
  it("the /notifications/preferences keys are exactly 1.2.0's", async () => {
    expect([...NOTIFICATION_TYPES]).toEqual(preferences120.backendKeys);
    for (const t of ["coach_event", "form_request", "form_reminder"]) {
      expect(NOTIFICATION_TYPES).not.toContain(t);
    }
  });

  it("GET /notifications returns the new types in the shape 1.2.0 parses", async () => {
    const form = await makeForm(COACH_A, "Goals");
    await makeSchedule(COACH_A, {
      formId: form.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_C],
      reminders: [{ afterHours: 1 }],
    });
    const [request] = await requestsFor(ATHLETE_C);
    await formPushesJob.run(
      ctx(new Date(request!.sentAt.getTime() + 3_700_000)),
    );
    const list = await http("GET", "/notifications", ATHLETE_C);
    expect(list.status).toBe(200);
    const types = list.json.rows.map((r: Json) => r.type).sort();
    expect(types).toEqual(["form_reminder", "form_request"]);
    for (const row of list.json.rows) {
      // Every field 1.2.0's mapApiNotification reads.
      expect(row).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        message: expect.any(String),
        data: expect.any(Object),
        createdAt: expect.any(String),
      });
      expect(row.data.deepLink).toBeUndefined();
      expect(row.data.deeplink).toBeUndefined();
    }
    // A coach's row carries the one deep link 1.2.0 routes for coaches.
    await recordCoachEvent(realDb(), {
      trainerId: COACH_A,
      clientId: ATHLETE_C,
      relationshipId: await relationshipId(COACH_A, ATHLETE_C),
      kind: "form_completed",
      payload: { formTitle: "Goals" },
      dedupeKey: "contract",
    }).then((id) => deliverCoachEvents([id!]));
    const coach = await http("GET", "/notifications", COACH_A);
    expect(coach.json.rows[0]).toMatchObject({
      type: "coach_event",
      data: { deepLink: "persistencemobile://clients" },
    });
  });
});

// ─── Migration ───────────────────────────────────────────────────────────────

describe(MIGRATION, () => {
  it("applies twice, rolls back and re-applies, with RLS on", async () => {
    const fresh = await baseDatabase();
    try {
      await fresh.exec("create type notification_type_check as enum ('x');");
      const sql = await read(MIGRATIONS, MIGRATION);
      await fresh.exec(sql);
      await fresh.exec(sql);
      const values = await fresh.query<{ v: string }>(
        "select unnest(enum_range(null::notification_type))::text as v",
      );
      expect(values.rows.map((r) => r.v)).toEqual(
        expect.arrayContaining([
          "coach_event",
          "form_request",
          "form_reminder",
        ]),
      );
      const rls = await fresh.query<{
        relname: string;
        relrowsecurity: boolean;
      }>(
        `select relname, relrowsecurity from pg_class
          where relname in ('coach_events','coach_notification_settings','coach_scheduler_runs')
          order by relname`,
      );
      expect(rls.rows).toEqual([
        { relname: "coach_events", relrowsecurity: true },
        { relname: "coach_notification_settings", relrowsecurity: true },
        { relname: "coach_scheduler_runs", relrowsecurity: true },
      ]);
      await fresh.exec(await read(ROLLBACKS, MIGRATION));
      const gone = await fresh.query(
        "select 1 from pg_class where relname = 'coach_events'",
      );
      expect(gone.rows).toHaveLength(0);
      await fresh.exec(sql);
      // The dedupe key and push-state check are enforced by the database.
      const coach = randomUUID();
      await fresh.exec(
        `insert into profiles (id) values ('${coach}');
         insert into coach_events (trainer_id, kind, dedupe_key) values ('${coach}', 'form_completed', 'k');`,
      );
      await expect(
        fresh.exec(
          `insert into coach_events (trainer_id, kind, dedupe_key) values ('${coach}', 'form_completed', 'k');`,
        ),
      ).rejects.toThrow();
      await expect(
        fresh.exec(
          `insert into coach_events (trainer_id, kind, dedupe_key, push_state) values ('${coach}', 'form_completed', 'k2', 'maybe');`,
        ),
      ).rejects.toThrow();
    } finally {
      await fresh.close();
    }
  });
});
