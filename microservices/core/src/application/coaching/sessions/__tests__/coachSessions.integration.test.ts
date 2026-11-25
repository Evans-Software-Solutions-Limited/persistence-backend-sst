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
 * PER-123 (BE-I2) — backend design I's calendar tests 1 (isolation and
 * offboarding), 3 (weekly repeats, editing one vs the series) and 4 (a
 * reminder sent once at the right time across the clock change, never for a
 * cancelled session), plus the routes, Today's schedule, the coach events,
 * the athlete pushes and the migration. Real migrations (PER-108, PER-116,
 * PER-117 and this one) on PGlite, real handlers, offboarding and scheduler.
 * Only the edges are stubbed: the JWT (bearer token = user id) and push
 * delivery, which is replaced by a recorder that still writes the inbox row.
 */

const holder = vi.hoisted(() => ({ db: null as unknown }));
const pushes = vi.hoisted(() => ({
  list: [] as { userId: string; input: Record<string, unknown> }[],
  failFor: null as string | null,
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
      if (pushes.failFor === userId) throw new Error("push down");
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

import Elysia from "elysia";
import { coreErrorHandler } from "../../../../shared/errorHandler";
import { coachingRoutes } from "../../../coachingRoutes";
import { notificationsListHandler } from "../../../notifications/list/notificationsListHandler";
import { NotificationDispatcher } from "../../../notifications/push/notificationDispatcher";
import { endCoachClientRelationship } from "../../../relationships/endCoachClientRelationship";
import { COACH_SCHEDULER_JOBS } from "../../scheduler/jobs";
import {
  REMINDER_PAGE,
  sessionRemindersJob,
} from "../../scheduler/jobs/sessionReminders";
import { announceSessionChanges } from "../sessionNotifications";
import { todaySchedule } from "../sessionRepository";
import { localDayBounds } from "../sessionTimes";

const MIGRATIONS = "../../../../../../../supabase/migrations/";
const ROLLBACKS = "../../../../../../../supabase/rollbacks/";
const read = (dir: string, file: string) =>
  readFile(new URL(`${dir}${file}`, import.meta.url), "utf8");
const A1 = "20261120120000_coaching_relationships_client_profiles.sql";
const FORMS = "20261120235941_coach_forms.sql";
const EVENTS = "20261123120117_coach_events_notifications.sql";
const MIGRATION = "20261125123634_coach_sessions_calendar.sql";

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
  schema.workouts,
  // PER-122: offboarding also removes this coach's resource assignments.
  schema.coachResources,
  schema.coachResourceAssignments,
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

const NOTIFICATION_ENUM =
  "DO $$ BEGIN CREATE TYPE notification_type AS ENUM ('coach_brief'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;";

/** Design A, C's forms and C's events applied, BEFORE this migration. */
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
  await pg.exec(await read(MIGRATIONS, EVENTS));
  return pg;
}

const COACH_A = randomUUID();
const COACH_B = randomUUID();
const ATHLETE_C = randomUUID();
const ATHLETE_E = randomUUID();
const ATHLETE_G = randomUUID();
const PLAIN_USER = randomUUID();
const COACHED_SINCE = new Date("2020-01-01T00:00:00Z");

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const app = new Elysia()
  .use(coreErrorHandler)
  .use(coachingRoutes)
  .use(notificationsListHandler);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function http(
  method: string,
  path: string,
  actor: string | null,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Json }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(actor ? { authorization: `Bearer ${actor}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
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

const pushesTo = (userId: string) =>
  pushes.list.filter((p) => p.userId === userId);

const sessionRows = async () =>
  db.select().from(schema.coachSessions).orderBy(schema.coachSessions.startsAt);

const attendeeRows = async () => db.select().from(schema.coachSessionAttendees);

async function book(coach: string, body: Record<string, unknown>) {
  const res = await http("POST", "/trainers/me/sessions", coach, {
    kind: "in_person",
    durationMin: 60,
    ...body,
  });
  expect(res.status).toBe(201);
  return res.json as { data: Json; series: Json[] };
}

/** Runs the reminder job every 15 minutes over [from, to). */
async function tickThrough(from: string, to: string) {
  const end = new Date(to).getTime();
  for (let t = new Date(from).getTime(); t < end; t += 15 * 60_000) {
    await sessionRemindersJob.run({
      now: new Date(t),
      dispatcher: new NotificationDispatcher(),
    });
  }
}

const reminders = () =>
  pushes.list.filter((p) => (p.input.data as Json)?.action === "reminder");

const FUTURE = "2027-03-23T09:00:00.000Z"; // Tue, GMT in London

/**
 * Runs `concurrent` SQL at the first `db.update(…)…returning()` (just before
 * that write executes) or the first `db.transaction(…)` (just before it
 * opens): someone else's write lands between this code's read and its write.
 */
async function withRace<T>(
  at: "update" | "transaction",
  concurrent: string,
  fn: () => Promise<T>,
): Promise<T> {
  const real = db;
  let armed = true;
  holder.db = new Proxy(real, {
    get(target, prop) {
      if (prop === at && armed) {
        armed = false;
        if (at === "transaction") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return async (cb: any) => {
            await pg.exec(concurrent);
            return target.transaction(cb);
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (table: any) => ({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          set: (values: any) => ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            where: (cond: any) => ({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              returning: async (cols: any) => {
                await pg.exec(concurrent);
                return target
                  .update(table)
                  .set(values)
                  .where(cond)
                  .returning(cols);
              },
            }),
          }),
        });
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    return await fn();
  } finally {
    holder.db = real;
  }
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
  pushes.failFor = null;
  REMINDER_PAGE.size = 500;
  await pg.exec(
    `truncate coach_session_attendees, coach_sessions, coach_scheduler_runs,
       coach_notification_settings, coach_events,
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
      timezone: "America/New_York",
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
    { id: PLAIN_USER, fullName: "Pat", role: "user" },
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
});

// ─── Test 3: weekly repeats, one vs the series ──────────────────────────────

describe("design I test 3: weekly repeats", () => {
  it("creates 26 bounded occurrences at the coach's local time across both clock changes", async () => {
    const res = await book(COACH_A, {
      // Tue 6 Oct 2026, 09:00 BST.
      startsAt: "2026-10-06T08:00:00Z",
      clientIds: [ATHLETE_C],
      repeat: { frequency: "weekly", count: 26 },
    });
    expect(res.series).toHaveLength(26);
    expect(res.data.id).toBe(res.series[0].id);
    const seriesId = res.data.seriesId;
    expect(seriesId).toEqual(expect.any(String));
    expect(res.series.every((s: Json) => s.seriesId === seriesId)).toBe(true);
    const starts = res.series.map((s: Json) => s.startsAt);
    // BST until 25 Oct, GMT until 28 Mar, then BST again.
    expect(starts[0]).toBe("2026-10-06T08:00:00.000Z");
    expect(starts[2]).toBe("2026-10-20T08:00:00.000Z");
    expect(starts[3]).toBe("2026-10-27T09:00:00.000Z");
    expect(starts[24]).toBe("2027-03-23T09:00:00.000Z");
    expect(starts[25]).toBe("2027-03-30T08:00:00.000Z");
    // Every occurrence books the attendee on its own row.
    expect(await attendeeRows()).toHaveLength(26);
    expect(res.data).toMatchObject({
      kind: "in_person",
      durationMin: 60,
      endsAt: "2026-10-06T09:00:00.000Z",
      revision: 1,
      cancelledAt: null,
      attendees: [
        {
          clientId: ATHLETE_C,
          name: "Chris",
          status: "invited",
          remindedAt: null,
        },
      ],
    });
    // One announcement for the whole series, not 26.
    const toC = pushesTo(ATHLETE_C);
    expect(toC).toHaveLength(1);
    expect(toC[0]!.input).toMatchObject({
      type: "coach_session",
      title: "Ellie booked a session with you",
      message: "In person · Tue 6 Oct, 09:00 · weekly, 26 sessions",
      data: {
        action: "booked",
        sessionId: res.data.id,
        startsAt: "2026-10-06T08:00:00.000Z",
        seriesId,
      },
      relatedEntityType: "coach_session",
      relatedEntityId: res.data.id,
    });
  });

  it("refuses more than 26 occurrences", async () => {
    const res = await http("POST", "/trainers/me/sessions", COACH_A, {
      kind: "in_person",
      durationMin: 60,
      startsAt: FUTURE,
      repeat: { frequency: "weekly", count: 27 },
    });
    expect(res.status).toBe(422);
    expect(await sessionRows()).toHaveLength(0);
  });

  it("edits one occurrence on its own, or it and the later ones in the series", async () => {
    const { series } = await book(COACH_A, {
      startsAt: "2026-10-20T08:00:00Z", // Tue 09:00 BST
      clientIds: [ATHLETE_C],
      repeat: { frequency: "weekly", count: 4 },
    });
    pushes.list = [];
    // This one: occurrence 1 moves to 11:00 on its own.
    const one = await http(
      "PATCH",
      `/trainers/me/sessions/${series[0].id}?scope=this`,
      COACH_A,
      { startsAt: "2026-10-20T10:00:00Z", expectedRevision: 1 },
    );
    expect(one.status).toBe(200);
    expect(one.json.data).toMatchObject({
      startsAt: "2026-10-20T10:00:00.000Z",
      revision: 2,
      seriesId: series[0].seriesId,
    });
    expect(one.json.series).toHaveLength(1);
    // The series from occurrence 2: Tue 09:00 → Wed 10:00, local.
    const rest = await http(
      "PATCH",
      `/trainers/me/sessions/${series[1].id}?scope=series`,
      COACH_A,
      { startsAt: "2026-10-28T10:00:00Z", location: "Studio 2" },
    );
    expect(rest.status).toBe(200);
    expect(rest.json.series.map((s: Json) => s.startsAt)).toEqual([
      "2026-10-28T10:00:00.000Z",
      "2026-11-04T10:00:00.000Z",
      "2026-11-11T10:00:00.000Z",
    ]);
    expect(rest.json.series.every((s: Json) => s.location === "Studio 2")).toBe(
      true,
    );
    const rows = await sessionRows();
    expect(rows.map((r) => [r.startsAt.toISOString(), r.revision])).toEqual([
      ["2026-10-20T10:00:00.000Z", 2],
      ["2026-10-28T10:00:00.000Z", 2],
      ["2026-11-04T10:00:00.000Z", 2],
      ["2026-11-11T10:00:00.000Z", 2],
    ]);
    // Each move told the athlete once.
    const moved = pushesTo(ATHLETE_C).map((p) => p.input);
    expect(moved.map((m) => (m.data as Json).action)).toEqual([
      "moved",
      "moved",
    ]);
    expect(moved[0]).toMatchObject({
      title: "Ellie moved your session",
      message: "In person · now Tue 20 Oct, 11:00",
    });
    // A field edit that isn't a move announces nothing.
    pushes.list = [];
    const note = await http(
      "PATCH",
      `/trainers/me/sessions/${series[0].id}`,
      COACH_A,
      { notes: "  Bring a towel  ", startsAt: "2026-10-20T10:00:30Z" },
    );
    expect(note.json.data.notes).toBe("Bring a towel");
    expect(pushes.list).toHaveLength(0);
  });

  it("cancels one occurrence, or it and the later ones; cancelling again changes nothing", async () => {
    const { series } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
      repeat: { frequency: "weekly", count: 4 },
    });
    pushes.list = [];
    const one = await http(
      "DELETE",
      `/trainers/me/sessions/${series[1].id}`,
      COACH_A,
    );
    expect(one.status).toBe(204);
    const again = await http(
      "DELETE",
      `/trainers/me/sessions/${series[1].id}?scope=series`,
      COACH_A,
    );
    expect(again.status).toBe(204);
    expect((await sessionRows()).map((r) => r.cancelledAt !== null)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    const rest = await http(
      "DELETE",
      `/trainers/me/sessions/${series[2].id}?scope=series`,
      COACH_A,
    );
    expect(rest.status).toBe(204);
    expect(
      (await sessionRows()).map((r) => [r.cancelledAt !== null, r.revision]),
    ).toEqual([
      [false, 1],
      [true, 2],
      [true, 2],
      [true, 2],
    ]);
    const cancelled = pushesTo(ATHLETE_C).map((p) => p.input);
    expect(cancelled).toHaveLength(2);
    expect(cancelled[0]).toMatchObject({
      title: "Ellie cancelled your session",
      data: { action: "cancelled", sessionId: series[1].id },
    });
    // A cancelled session can't be edited.
    const edit = await http(
      "PATCH",
      `/trainers/me/sessions/${series[3].id}`,
      COACH_A,
      { durationMin: 30 },
    );
    expect(edit.status).toBe(409);
    expect(edit.json).toMatchObject({
      code: "session_cancelled",
      current: { id: series[3].id },
    });
  });

  it("a stale expectedRevision gets 409 revision_conflict with the current row", async () => {
    const { data } = await book(COACH_A, { startsAt: FUTURE });
    await http("PATCH", `/trainers/me/sessions/${data.id}`, COACH_A, {
      durationMin: 45,
    });
    const stale = await http(
      "PATCH",
      `/trainers/me/sessions/${data.id}`,
      COACH_A,
      { durationMin: 30, expectedRevision: 1 },
    );
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({
      code: "revision_conflict",
      current: { id: data.id, durationMin: 45, revision: 2 },
    });
    const missing = await http(
      "PATCH",
      `/trainers/me/sessions/${randomUUID()}`,
      COACH_A,
      { durationMin: 30 },
    );
    expect(missing.status).toBe(404);
  });

  it("a replayed create (same Idempotency-Key) returns the first rows and announces once", async () => {
    const headers = { "idempotency-key": "local-session-1" };
    const body = {
      kind: "video",
      durationMin: 30,
      startsAt: FUTURE,
      videoUrl: "https://meet.example.com/abc",
      clientIds: [ATHLETE_C],
      repeat: { frequency: "weekly", count: 2 },
    };
    const first = await http(
      "POST",
      "/trainers/me/sessions",
      COACH_A,
      body,
      headers,
    );
    const second = await http(
      "POST",
      "/trainers/me/sessions",
      COACH_A,
      body,
      headers,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.json).toEqual(first.json);
    expect(await sessionRows()).toHaveLength(2);
    expect(pushesTo(ATHLETE_C)).toHaveLength(1);
    expect(first.json.data.videoUrl).toBe("https://meet.example.com/abc");
  });
});

// ─── Attendees, validation, events ──────────────────────────────────────────

describe("booking rules", () => {
  it("validates kinds, links, workouts and own training", async () => {
    const bad = (body: object) =>
      http("POST", "/trainers/me/sessions", COACH_A, {
        kind: "in_person",
        durationMin: 60,
        startsAt: FUTURE,
        ...body,
      });
    expect((await bad({ kind: "party" })).status).toBe(422);
    expect((await bad({ durationMin: 2 })).status).toBe(422);
    const date = await bad({ startsAt: "not a date" });
    expect(date.status).toBe(422);
    expect(date.json.code).toBe("invalid_session");
    const http1 = await bad({ kind: "video", videoUrl: "http://x.test" });
    expect(http1.status).toBe(422);
    expect(http1.json.message).toMatch(/https/);
    const own = await bad({ kind: "own_training", clientIds: [ATHLETE_C] });
    expect(own.status).toBe(422);
    const someoneElses = randomUUID();
    await db
      .insert(schema.workouts)
      .values({ id: someoneElses, name: "Theirs", createdBy: COACH_B });
    const workout = await bad({ workoutId: someoneElses });
    expect(workout.status).toBe(404);
    expect(workout.json.code).toBe("workout_not_found");
    expect(await sessionRows()).toHaveLength(0);

    const mine = randomUUID();
    await db
      .insert(schema.workouts)
      .values({ id: mine, name: "Upper B", createdBy: COACH_A });
    const ok = await bad({
      workoutId: mine,
      location: "   ",
      reminderMinutes: 30,
      startsAt: "2027-03-23T09:00:42.123Z",
    });
    expect(ok.status).toBe(201);
    expect(ok.json.data).toMatchObject({
      workout: { id: mine, name: "Upper B" },
      location: null,
      reminderMinutes: 30,
      startsAt: FUTURE,
      attendees: [],
    });
    // A session with nobody booked announces nothing.
    expect(pushes.list).toHaveLength(0);
    // Own training can't gain clients through an edit either.
    const training = await bad({ kind: "own_training" });
    const add = await http(
      "PATCH",
      `/trainers/me/sessions/${training.json.data.id}`,
      COACH_A,
      { clientIds: [ATHLETE_C] },
    );
    expect(add.status).toBe(422);
    const booked = await bad({ clientIds: [ATHLETE_C] });
    const toOwn = await http(
      "PATCH",
      `/trainers/me/sessions/${booked.json.data.id}`,
      COACH_A,
      { kind: "own_training" },
    );
    expect(toOwn.status).toBe(422);
    const http2 = await http(
      "PATCH",
      `/trainers/me/sessions/${booked.json.data.id}`,
      COACH_A,
      { videoUrl: "ftp://x" },
    );
    expect(http2.status).toBe(422);
    const date2 = await http(
      "PATCH",
      `/trainers/me/sessions/${booked.json.data.id}`,
      COACH_A,
      { startsAt: "soon" },
    );
    expect(date2.status).toBe(422);
  });

  it("adds and removes attendees with an edit, announcing booked and cancelled", async () => {
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C, ATHLETE_C],
    });
    expect(data.attendees).toHaveLength(1);
    pushes.list = [];
    const swap = await http(
      "PATCH",
      `/trainers/me/sessions/${data.id}`,
      COACH_A,
      { clientIds: [ATHLETE_E], startsAt: "2027-03-23T10:00:00Z" },
    );
    expect(swap.status).toBe(200);
    expect(
      swap.json.data.attendees.map((a: Json) => [a.clientId, a.status]),
    ).toEqual([
      [ATHLETE_C, "cancelled"],
      [ATHLETE_E, "invited"],
    ]);
    // C, taken off, hears it was cancelled; E, added, hears booked (not moved).
    expect(
      pushesTo(ATHLETE_C).map((p) => (p.input.data as Json).action),
    ).toEqual(["cancelled"]);
    expect(
      pushesTo(ATHLETE_E).map((p) => (p.input.data as Json).action),
    ).toEqual(["booked"]);
    // In E's own zone.
    expect(pushesTo(ATHLETE_E)[0]!.input.message).toBe(
      "In person · Tue 23 Mar, 06:00",
    );
    // Back on: C is invited again.
    const back = await http(
      "PATCH",
      `/trainers/me/sessions/${data.id}`,
      COACH_A,
      { clientIds: [ATHLETE_C, ATHLETE_E] },
    );
    expect(
      back.json.data.attendees.map((a: Json) => [a.clientId, a.status]),
    ).toEqual([
      [ATHLETE_C, "invited"],
      [ATHLETE_E, "invited"],
    ]);
  });

  it("writes one session_booked coach event per attendee, feed only", async () => {
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C, ATHLETE_E],
    });
    await http("PATCH", `/trainers/me/sessions/${data.id}`, COACH_A, {
      startsAt: "2027-03-24T09:00:00Z",
    });
    await http("DELETE", `/trainers/me/sessions/${data.id}`, COACH_A);
    const events = await db
      .select()
      .from(schema.coachEvents)
      .where(eq(schema.coachEvents.trainerId, COACH_A));
    expect(events).toHaveLength(6);
    expect(events.every((e) => e.kind === "session_booked")).toBe(true);
    expect(events.every((e) => e.pushState === "none")).toBe(true);
    expect(events.map((e) => (e.payload as Json).action).sort()).toEqual([
      "booked",
      "booked",
      "cancelled",
      "cancelled",
      "moved",
      "moved",
    ]);
    expect(events[0]).toMatchObject({
      entityType: "coach_session",
      entityId: data.id,
    });
    // The coach was never pushed about their own change.
    expect(pushesTo(COACH_A)).toHaveLength(0);
    // Still in the coach's feed, never in Today's queue.
    const feed = await http("GET", "/trainers/me/notifications", COACH_A);
    expect(feed.json.data).toHaveLength(6);
    const today = await http("GET", "/trainers/me/today", COACH_A);
    expect(today.json.data.counts.total).toBe(0);
  });

  it("a second cancellation for the same attendee is its own feed event (Inspector Brad, #568)", async () => {
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    const path = `/trainers/me/sessions/${data.id}`;
    // Taken off, put back, taken off again.
    await http("PATCH", path, COACH_A, { clientIds: [] });
    await http("PATCH", path, COACH_A, { clientIds: [ATHLETE_C] });
    await http("PATCH", path, COACH_A, { clientIds: [] });
    const events = await db
      .select()
      .from(schema.coachEvents)
      .where(eq(schema.coachEvents.trainerId, COACH_A));
    const actions = events.map((e) => (e.payload as Json).action).sort();
    expect(actions).toEqual(["booked", "booked", "cancelled", "cancelled"]);
    expect(new Set(events.map((e) => e.dedupeKey)).size).toBe(4);
    // A replayed write still dedupes: the same change again adds nothing.
    await announceSessionChanges(COACH_A, [
      {
        action: "cancelled",
        // The last removal was revision 4.
        session: { ...data, revision: 4 },
        attendees: [
          {
            clientId: ATHLETE_C,
            relationshipId: await relationshipId(COACH_A, ATHLETE_C),
          },
        ],
        occurrences: 1,
      },
    ]);
    expect(
      await db
        .select()
        .from(schema.coachEvents)
        .where(eq(schema.coachEvents.trainerId, COACH_A)),
    ).toHaveLength(4);
  });

  it("a failed push or event write never fails the booking", async () => {
    pushes.failFor = ATHLETE_C;
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    expect(data.attendees).toHaveLength(1);
    // A broken change (an unknown coach) is swallowed too.
    await expect(
      announceSessionChanges("not-a-uuid", [
        {
          action: "booked",
          session: data,
          attendees: [{ clientId: ATHLETE_C, relationshipId: "x" }],
          occurrences: 1,
        },
      ]),
    ).resolves.toBeUndefined();
  });

  it("needs a trainer role and a signed-in user", async () => {
    expect((await http("GET", "/trainers/me/calendar", null)).status).toBe(401);
    const plain = await http("POST", "/trainers/me/sessions", PLAIN_USER, {
      kind: "in_person",
      durationMin: 60,
      startsAt: FUTURE,
    });
    expect(plain.status).toBe(403);
    expect(plain.json.code).toBe("not_a_trainer");
    expect((await http("GET", "/users/me/coach-sessions", null)).status).toBe(
      401,
    );
  });
});

// ─── Test 1: isolation and offboarding ──────────────────────────────────────

describe("design I test 1: isolation", () => {
  it("coach B can't see, edit, cancel or book on coach A's sessions or clients", async () => {
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    const range = "from=2027-03-20T00:00:00Z&to=2027-03-30T00:00:00Z";
    const mine = await http("GET", `/trainers/me/calendar?${range}`, COACH_A);
    expect(mine.json.data.sessions.map((s: Json) => s.id)).toEqual([data.id]);
    const theirs = await http("GET", `/trainers/me/calendar?${range}`, COACH_B);
    expect(theirs.json.data.sessions).toEqual([]);
    const edit = await http(
      "PATCH",
      `/trainers/me/sessions/${data.id}`,
      COACH_B,
      { durationMin: 15 },
    );
    expect(edit.status).toBe(404);
    const cancel = await http(
      "DELETE",
      `/trainers/me/sessions/${data.id}`,
      COACH_B,
    );
    expect(cancel.status).toBe(204);
    const [row] = await sessionRows();
    expect(row).toMatchObject({ durationMin: 60, cancelledAt: null });
    // E is A's client only.
    const booking = await http("POST", "/trainers/me/sessions", COACH_B, {
      kind: "in_person",
      durationMin: 60,
      startsAt: FUTURE,
      clientIds: [ATHLETE_C, ATHLETE_E],
    });
    expect(booking.status).toBe(403);
    expect(booking.json).toMatchObject({
      code: "not_your_client",
      clientIds: [ATHLETE_E],
    });
    const viaEdit = await http(
      "PATCH",
      `/trainers/me/sessions/${data.id}`,
      COACH_A,
      { clientIds: [ATHLETE_G] },
    );
    expect(viaEdit.status).toBe(403);
  });

  it("an athlete sees only their own bookings from active coaches, and loses them after offboarding", async () => {
    const a = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C, ATHLETE_E],
      notes: "Private coach note",
      location: "Gym",
    });
    const b = await book(COACH_B, {
      startsAt: "2027-03-24T15:00:00Z",
      clientIds: [ATHLETE_C],
    });
    // A past booking stays as history when coaching ends.
    const past = await book(COACH_A, {
      startsAt: "2026-01-06T09:00:00Z",
      clientIds: [ATHLETE_C],
    });
    const range = "from=2027-03-01T00:00:00Z&to=2027-04-01T00:00:00Z";
    const list = await http(
      "GET",
      `/users/me/coach-sessions?${range}`,
      ATHLETE_C,
    );
    expect(list.status).toBe(200);
    expect(list.json.data.sessions.map((s: Json) => s.id)).toEqual([
      a.data.id,
      b.data.id,
    ]);
    const first = list.json.data.sessions[0];
    expect(first).toMatchObject({
      status: "invited",
      location: "Gym",
      coach: { id: COACH_A, name: "Ellie" },
    });
    // Never other attendees or the coach's notes.
    expect(first.attendees).toBeUndefined();
    expect(first.notes).toBeUndefined();
    // G has no coach and sees nothing.
    const g = await http("GET", `/users/me/coach-sessions?${range}`, ATHLETE_G);
    expect(g.json.data.sessions).toEqual([]);

    const ended = await endCoachClientRelationship({
      trainerId: COACH_A,
      clientId: ATHLETE_C,
      initiatedBy: "client",
    });
    expect(ended.ok).toBe(true);
    const after = await http(
      "GET",
      `/users/me/coach-sessions?${range}`,
      ATHLETE_C,
    );
    expect(after.json.data.sessions.map((s: Json) => s.id)).toEqual([
      b.data.id,
    ]);
    const relC = await relationshipId(COACH_A, ATHLETE_C);
    const rows = (await attendeeRows()).filter(
      (r) => r.relationshipId === relC,
    );
    const statusOf = (sessionId: string) =>
      rows.find((r) => r.sessionId === sessionId)!.status;
    expect(statusOf(a.data.id)).toBe("cancelled");
    expect(statusOf(past.data.id)).toBe("invited");
    // E is still booked on the group session, which goes on.
    const calendar = await http(
      "GET",
      `/trainers/me/calendar?${range}`,
      COACH_A,
    );
    expect(calendar.json.data.sessions[0]).toMatchObject({
      id: a.data.id,
      cancelledAt: null,
    });
    expect(
      calendar.json.data.sessions[0].attendees.map((x: Json) => [
        x.clientId,
        x.status,
      ]),
    ).toEqual([
      [ATHLETE_C, "cancelled"],
      [ATHLETE_E, "invited"],
    ]);
    // C can't respond to A's session any more.
    const respond = await http(
      "POST",
      `/users/me/coach-sessions/${a.data.id}/respond`,
      ATHLETE_C,
      { status: "accepted" },
    );
    expect(respond.status).toBe(404);
  });
});

// ─── Athlete responses ──────────────────────────────────────────────────────

describe("athlete accept or decline", () => {
  it("accepts and declines idempotently, with no coach event", async () => {
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    const path = `/users/me/coach-sessions/${data.id}/respond`;
    const yes = await http("POST", path, ATHLETE_C, { status: "accepted" });
    expect(yes.status).toBe(200);
    expect(yes.json.data).toMatchObject({ id: data.id, status: "accepted" });
    const again = await http("POST", path, ATHLETE_C, { status: "accepted" });
    expect(again.json.data.status).toBe("accepted");
    const no = await http("POST", path, ATHLETE_C, { status: "declined" });
    expect(no.json.data.status).toBe("declined");
    const events = await db.select().from(schema.coachEvents);
    expect(events.map((e) => (e.payload as Json).action)).toEqual(["booked"]);
    expect(
      (await http("POST", path, ATHLETE_C, { status: "maybe" })).status,
    ).toBe(422);
    // Another athlete isn't booked on it.
    expect(
      (await http("POST", path, ATHLETE_E, { status: "accepted" })).status,
    ).toBe(404);
  });

  it("refuses a cancelled session, a removed booking and a session that started", async () => {
    const cancelled = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    await http("DELETE", `/trainers/me/sessions/${cancelled.data.id}`, COACH_A);
    const r1 = await http(
      "POST",
      `/users/me/coach-sessions/${cancelled.data.id}/respond`,
      ATHLETE_C,
      { status: "accepted" },
    );
    expect(r1.status).toBe(409);
    expect(r1.json.code).toBe("session_cancelled");

    const removed = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    await http("PATCH", `/trainers/me/sessions/${removed.data.id}`, COACH_A, {
      clientIds: [],
    });
    const r2 = await http(
      "POST",
      `/users/me/coach-sessions/${removed.data.id}/respond`,
      ATHLETE_C,
      { status: "accepted" },
    );
    expect(r2.status).toBe(409);
    expect(r2.json.code).toBe("not_booked");

    const started = await book(COACH_A, {
      startsAt: "2026-01-06T09:00:00Z",
      clientIds: [ATHLETE_C],
    });
    const r3 = await http(
      "POST",
      `/users/me/coach-sessions/${started.data.id}/respond`,
      ATHLETE_C,
      { status: "declined" },
    );
    expect(r3.status).toBe(409);
    expect(r3.json.code).toBe("session_started");
  });

  /**
   * Runs `concurrent` SQL just before the respond UPDATE executes, after its
   * read: the coach's write lands between the athlete's check and write.
   */
  async function respondRacing(
    sessionId: string,
    concurrent: string,
    status: "accepted" | "declined" = "accepted",
  ) {
    const real = db;
    let armed = true;
    holder.db = new Proxy(real, {
      get(target, prop) {
        if (prop === "update" && armed) {
          armed = false;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (table: any) => ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            set: (values: any) => ({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              where: (cond: any) => ({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                returning: async (cols: any) => {
                  await pg.exec(concurrent);
                  return target
                    .update(table)
                    .set(values)
                    .where(cond)
                    .returning(cols);
                },
              }),
            }),
          });
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      return await http(
        "POST",
        `/users/me/coach-sessions/${sessionId}/respond`,
        ATHLETE_C,
        { status },
      );
    } finally {
      holder.db = real;
    }
  }

  it("a coach's concurrent removal, cancel or offboarding always wins over a response (Inspector Brad, #568)", async () => {
    const statusOf = async (sessionId: string) =>
      (await attendeeRows()).find(
        (r) => r.sessionId === sessionId && r.clientId === ATHLETE_C,
      )!.status;

    const removed = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    const r1 = await respondRacing(
      removed.data.id,
      `update coach_session_attendees set status = 'cancelled' where session_id = '${removed.data.id}'`,
    );
    expect(r1.status).toBe(409);
    expect(r1.json.code).toBe("not_booked");
    expect(await statusOf(removed.data.id)).toBe("cancelled");

    const cancelled = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    const r2 = await respondRacing(
      cancelled.data.id,
      `update coach_sessions set cancelled_at = now() where id = '${cancelled.data.id}'`,
    );
    expect(r2.status).toBe(409);
    expect(r2.json.code).toBe("session_cancelled");
    expect(await statusOf(cancelled.data.id)).toBe("invited");

    const ended = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    const relC = await relationshipId(COACH_A, ATHLETE_C);
    const r3 = await respondRacing(
      ended.data.id,
      `update pt_client_relationships set status = 'terminated' where id = '${relC}'`,
    );
    expect(r3.status).toBe(404);
    expect(await statusOf(ended.data.id)).toBe("invited");
    await pg.exec(
      `update pt_client_relationships set status = 'active' where id = '${relC}'`,
    );

    // The same answer landing first (a replayed request) is still a success.
    const same = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    const r4 = await respondRacing(
      same.data.id,
      `update coach_session_attendees set status = 'accepted' where session_id = '${same.data.id}'`,
    );
    expect(r4.status).toBe(200);
    expect(r4.json.data.status).toBe("accepted");

    // The session started between the read and the write.
    const starting = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    const r5 = await respondRacing(
      starting.data.id,
      `update coach_sessions set starts_at = now() - interval '1 minute' where id = '${starting.data.id}'`,
    );
    expect(r5.status).toBe(409);
    expect(r5.json.code).toBe("session_started");
    expect(await statusOf(starting.data.id)).toBe("invited");
  });

  it("returns the session by id even if a move lands meanwhile (Inspector Brad, #568)", async () => {
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    const res = await withRace(
      "update",
      `update coach_sessions set starts_at = '2027-03-23T12:00:00Z' where id = '${data.id}'`,
      () =>
        http("POST", `/users/me/coach-sessions/${data.id}/respond`, ATHLETE_C, {
          status: "accepted",
        }),
    );
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      id: data.id,
      status: "accepted",
      startsAt: "2027-03-23T12:00:00.000Z",
    });
  });

  it("a session whose coach's account is deleted can't be seen or answered", async () => {
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    await pg.exec(
      `update profiles set deleted_at = now() where id = '${COACH_A}'`,
    );
    const list = await http(
      "GET",
      "/users/me/coach-sessions?from=2027-03-01&to=2027-04-01",
      ATHLETE_C,
    );
    expect(list.json.data.sessions).toEqual([]);
    const res = await http(
      "POST",
      `/users/me/coach-sessions/${data.id}/respond`,
      ATHLETE_C,
      { status: "accepted" },
    );
    expect(res.status).toBe(404);
    expect((await attendeeRows())[0]!.status).toBe("invited");
  });
});

describe("bookings racing offboarding (Inspector Brad, #568)", () => {
  it("a client whose coaching ends before the booking commits is left off it, and not told", async () => {
    const relC = await relationshipId(COACH_A, ATHLETE_C);
    const end = `update pt_client_relationships set status = 'terminated' where id = '${relC}'`;
    const res = await withRace("transaction", end, () =>
      http("POST", "/trainers/me/sessions", COACH_A, {
        kind: "in_person",
        durationMin: 60,
        startsAt: FUTURE,
        clientIds: [ATHLETE_C, ATHLETE_E],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.json.data.attendees.map((a: Json) => a.clientId)).toEqual([
      ATHLETE_E,
    ]);
    expect(pushesTo(ATHLETE_C)).toHaveLength(0);
    expect(pushesTo(ATHLETE_E)).toHaveLength(1);
    const events = await db.select().from(schema.coachEvents);
    expect(events.map((e) => e.clientId)).toEqual([ATHLETE_E]);
  });

  it("an edit adding a client whose coaching just ended doesn't book them", async () => {
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_E],
    });
    pushes.list = [];
    const relC = await relationshipId(COACH_A, ATHLETE_C);
    const res = await withRace(
      "transaction",
      `update pt_client_relationships set status = 'terminated' where id = '${relC}'`,
      () =>
        http("PATCH", `/trainers/me/sessions/${data.id}`, COACH_A, {
          clientIds: [ATHLETE_E, ATHLETE_C],
        }),
    );
    expect(res.status).toBe(200);
    expect(res.json.data.attendees.map((a: Json) => a.clientId)).toEqual([
      ATHLETE_E,
    ]);
    expect(pushes.list).toHaveLength(0);
  });

  it("lists upcoming sessions by default and checks the range", async () => {
    const soon = new Date(Date.now() + 86_400_000).toISOString();
    const { data } = await book(COACH_A, {
      startsAt: soon,
      clientIds: [ATHLETE_C],
    });
    await book(COACH_A, {
      startsAt: "2026-01-06T09:00:00Z",
      clientIds: [ATHLETE_C],
    });
    const list = await http("GET", "/users/me/coach-sessions", ATHLETE_C);
    expect(list.json.data.sessions.map((s: Json) => s.id)).toEqual([data.id]);
    expect(list.json.data.asOf).toEqual(expect.any(String));
    for (const q of [
      "from=nope",
      "from=2027-01-01&to=2026-12-01",
      "from=2027-01-01&to=2027-06-01",
    ]) {
      const res = await http("GET", `/users/me/coach-sessions?${q}`, ATHLETE_C);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe("invalid_range");
    }
  });
});

// ─── Calendar and Today ─────────────────────────────────────────────────────

describe("calendar and Today", () => {
  it("returns sessions (cancelled ones flagged) and forms due in range, at most 62 days", async () => {
    const live = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
    });
    const gone = await book(COACH_A, { startsAt: "2027-03-22T09:00:00Z" });
    await http("DELETE", `/trainers/me/sessions/${gone.data.id}`, COACH_A);
    await book(COACH_A, { startsAt: "2027-05-22T09:00:00Z" });
    // A form request due in range, one cancelled, one out of range.
    const form = await http("POST", "/trainers/me/forms", COACH_A, {
      title: "Weekly check-in",
      questions: [{ id: "q1", type: "short_text", prompt: "How was it?" }],
    });
    expect(form.status).toBe(201);
    const relC = await relationshipId(COACH_A, ATHLETE_C);
    const request = (periodKey: string, dueAt: string, status = "pending") => ({
      trainerId: COACH_A,
      clientId: ATHLETE_C,
      relationshipId: relC,
      formId: form.json.data.id,
      formVersionId: form.json.data.version.id,
      trigger: "once",
      periodKey,
      dueAt: new Date(dueAt),
      status,
    });
    await db
      .insert(schema.coachFormRequests)
      .values([
        request("a", "2027-03-25T12:00:00Z"),
        request("b", "2027-03-26T12:00:00Z", "cancelled"),
        request("c", "2027-06-01T12:00:00Z"),
      ]);
    const res = await http(
      "GET",
      "/trainers/me/calendar?from=2027-03-20&to=2027-03-30",
      COACH_A,
    );
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      from: "2027-03-20T00:00:00.000Z",
      to: "2027-03-30T00:00:00.000Z",
      asOf: expect.any(String),
    });
    expect(
      res.json.data.sessions.map((s: Json) => [s.id, s.cancelledAt !== null]),
    ).toEqual([
      [gone.data.id, true],
      [live.data.id, false],
    ]);
    expect(res.json.data.formsDue).toEqual([
      {
        requestId: expect.any(String),
        formId: form.json.data.id,
        formTitle: "Weekly check-in",
        client: { id: ATHLETE_C, name: "Chris", avatarUrl: null },
        dueAt: "2027-03-25T12:00:00.000Z",
        status: "pending",
        late: false,
      },
    ]);
    // Coach B never sees A's forms due.
    const b = await http(
      "GET",
      "/trainers/me/calendar?from=2027-03-20&to=2027-03-30",
      COACH_B,
    );
    expect(b.json.data.formsDue).toEqual([]);
    for (const q of [
      "",
      "from=2027-03-20",
      "from=x&to=y",
      "from=2027-03-20&to=2027-03-19",
      "from=2027-01-01&to=2027-03-05",
    ]) {
      const bad = await http("GET", `/trainers/me/calendar?${q}`, COACH_A);
      expect(bad.status).toBe(400);
      expect(bad.json.code).toBe("invalid_range");
    }
    // Exactly 62 days is allowed.
    expect(
      (
        await http(
          "GET",
          "/trainers/me/calendar?from=2027-01-01&to=2027-03-04",
          COACH_A,
        )
      ).status,
    ).toBe(200);
  });

  it("Today's schedule is today's live bookings in the coach's time zone", async () => {
    const now = new Date("2026-11-25T23:30:00Z");
    // New York (B's zone): still 25 Nov, 18:30. London: 25 Nov, 23:30.
    const nyBounds = localDayBounds(now, "America/New_York");
    expect(nyBounds.start.toISOString()).toBe("2026-11-25T05:00:00.000Z");
    expect(nyBounds.end.toISOString()).toBe("2026-11-26T05:00:00.000Z");
    const late = await book(COACH_B, { startsAt: "2026-11-26T02:00:00Z" });
    await book(COACH_B, { startsAt: "2026-11-26T06:00:00Z" });
    const cancelled = await book(COACH_B, {
      startsAt: "2026-11-25T20:00:00Z",
    });
    await http("DELETE", `/trainers/me/sessions/${cancelled.data.id}`, COACH_B);
    const early = await book(COACH_B, {
      kind: "own_training",
      startsAt: "2026-11-25T12:00:00Z",
    });
    expect((await todaySchedule(COACH_B, now)).map((s) => s.id)).toEqual([
      early.data.id,
      late.data.id,
    ]);
    expect(await todaySchedule(COACH_A, now)).toEqual([]);

    // The route uses the real clock: a session at local midnight today.
    const { start } = localDayBounds(new Date(), "Europe/London");
    const today = await book(COACH_A, {
      startsAt: start.toISOString(),
      clientIds: [ATHLETE_C],
    });
    const res = await http("GET", "/trainers/me/today", COACH_A);
    expect(res.json.data.schedule.map((s: Json) => s.id)).toEqual([
      today.data.id,
    ]);
    expect(res.json.data.schedule[0].attendees[0]).toMatchObject({
      clientId: ATHLETE_C,
      name: "Chris",
    });
  });
});

// ─── Test 4: reminders ──────────────────────────────────────────────────────

describe("design I test 4: reminders", () => {
  it("sends each reminder once, at the right time, across the clock change", async () => {
    // Tue 23 Mar 09:00 GMT, then Tue 30 Mar 09:00 BST (London goes forward on
    // the 28th). An hour's reminder: 08:00Z, then 07:00Z.
    const { series } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
      reminderMinutes: 60,
      location: "Gym",
      repeat: { frequency: "weekly", count: 2 },
    });
    expect(series[1].startsAt).toBe("2027-03-30T08:00:00.000Z");
    pushes.list = [];
    await tickThrough("2027-03-23T06:00:00Z", "2027-03-23T10:00:00Z");
    await tickThrough("2027-03-30T05:00:00Z", "2027-03-30T09:00:00Z");
    const sent = reminders();
    expect(sent).toHaveLength(2);
    expect(sent[0]!.input).toMatchObject({
      type: "coach_session",
      title: "Session with Ellie soon",
      message: "In person · Tue 23 Mar, 09:00 · Gym",
      data: { action: "reminder", sessionId: series[0].id },
    });
    expect(sent[1]!.input.message).toBe("In person · Tue 30 Mar, 09:00 · Gym");
    const rows = (await attendeeRows()).sort((a, b) =>
      a.remindedAt!.getTime() < b.remindedAt!.getTime() ? -1 : 1,
    );
    // Claimed on the first tick at or after starts_at − 60 min.
    expect(rows.map((r) => r.remindedAt!.toISOString())).toEqual([
      "2027-03-23T08:00:00.000Z",
      "2027-03-30T07:00:00.000Z",
    ]);
    // Running again never resends.
    await tickThrough("2027-03-23T06:00:00Z", "2027-03-23T10:00:00Z");
    expect(reminders()).toHaveLength(2);
  });

  it("never reminds a cancelled session, a declined or removed attendee, or after the start", async () => {
    const cancelled = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
      reminderMinutes: 30,
    });
    await http("DELETE", `/trainers/me/sessions/${cancelled.data.id}`, COACH_A);
    const declined = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C, ATHLETE_E],
      reminderMinutes: 30,
    });
    await http(
      "POST",
      `/users/me/coach-sessions/${declined.data.id}/respond`,
      ATHLETE_C,
      { status: "declined" },
    );
    await book(COACH_A, { startsAt: FUTURE, clientIds: [ATHLETE_C] });
    pushes.list = [];
    // Only after the start: nothing.
    await tickThrough("2027-03-23T09:00:00Z", "2027-03-23T10:00:00Z");
    expect(reminders()).toHaveLength(0);
    await tickThrough("2027-03-23T08:00:00Z", "2027-03-23T09:00:00Z");
    expect(reminders().map((p) => p.userId)).toEqual([ATHLETE_E]);
  });

  it("moving a session lets its reminder go out again; a failed push is not retried", async () => {
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C, ATHLETE_E],
      reminderMinutes: 15,
    });
    pushes.failFor = ATHLETE_E;
    await sessionRemindersJob.run({
      now: new Date("2027-03-23T08:50:00Z"),
      dispatcher: new NotificationDispatcher(),
    });
    expect(reminders().map((p) => p.userId)).toEqual([ATHLETE_C]);
    pushes.failFor = null;
    await http("PATCH", `/trainers/me/sessions/${data.id}`, COACH_A, {
      startsAt: "2027-03-23T11:00:00Z",
    });
    expect((await attendeeRows()).every((r) => r.remindedAt === null)).toBe(
      true,
    );
    pushes.list = [];
    const summary = await sessionRemindersJob.run({
      now: new Date("2027-03-23T10:45:00Z"),
      dispatcher: new NotificationDispatcher(),
    });
    expect(summary).toEqual({ claimed: 2, sent: 2 });
  });

  it("pages through every due reminder", async () => {
    REMINDER_PAGE.size = 1;
    await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C, ATHLETE_E],
      reminderMinutes: 60,
    });
    const summary = await sessionRemindersJob.run({
      now: new Date("2027-03-23T08:30:00Z"),
      dispatcher: new NotificationDispatcher(),
    });
    expect(summary).toEqual({ claimed: 2, sent: 2 });
  });

  it("refuses a reminder shorter than one scheduler tick (Inspector Brad, #568)", async () => {
    for (const reminderMinutes of [0, 14]) {
      const res = await http("POST", "/trainers/me/sessions", COACH_A, {
        kind: "in_person",
        durationMin: 60,
        startsAt: FUTURE,
        reminderMinutes,
      });
      expect(res.status).toBe(422);
    }
    expect(await sessionRows()).toHaveLength(0);
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      reminderMinutes: 15,
    });
    expect(data.reminderMinutes).toBe(15);
    const edit = await http(
      "PATCH",
      `/trainers/me/sessions/${data.id}`,
      COACH_A,
      { reminderMinutes: 14 },
    );
    expect(edit.status).toBe(422);
    expect((await sessionRows())[0]!.reminderMinutes).toBe(15);
  });

  it("a 15-minute reminder always lands on a tick before an off-tick start", async () => {
    // 09:07 start: due 08:52, so the 09:00 tick sends it, before the start.
    const { data } = await book(COACH_A, {
      startsAt: "2027-03-23T09:07:00Z",
      clientIds: [ATHLETE_C],
      reminderMinutes: 15,
    });
    expect(data.startsAt).toBe("2027-03-23T09:07:00.000Z");
    pushes.list = [];
    await tickThrough("2027-03-23T08:00:00Z", "2027-03-23T09:30:00Z");
    expect(reminders()).toHaveLength(1);
    const [row] = await attendeeRows();
    expect(row!.remindedAt!.toISOString()).toBe("2027-03-23T09:00:00.000Z");
  });

  it("a move, cancel or removal between the read and the claim sends no stale reminder (Inspector Brad, #568)", async () => {
    const runAt = (iso: string) =>
      sessionRemindersJob.run({
        now: new Date(iso),
        dispatcher: new NotificationDispatcher(),
      });
    const { data } = await book(COACH_A, {
      startsAt: FUTURE,
      clientIds: [ATHLETE_C],
      reminderMinutes: 60,
    });
    pushes.list = [];
    // Moved to 11:00 just before the claim (a move clears reminded_at).
    const moved = await withRace(
      "update",
      `update coach_sessions set starts_at = '2027-03-23T11:00:00Z' where id = '${data.id}';
       update coach_session_attendees set reminded_at = null where session_id = '${data.id}';`,
      () => runAt("2027-03-23T08:15:00Z"),
    );
    expect(moved).toEqual({ claimed: 0, sent: 0 });
    expect(reminders()).toHaveLength(0);
    expect((await attendeeRows())[0]!.remindedAt).toBeNull();
    // The new time is still reminded.
    expect(await runAt("2027-03-23T10:00:00Z")).toEqual({
      claimed: 1,
      sent: 1,
    });
    expect(reminders()[0]!.input.message).toBe("In person · Tue 23 Mar, 11:00");

    const cancelled = await book(COACH_A, {
      startsAt: "2027-03-24T09:00:00Z",
      clientIds: [ATHLETE_C],
      reminderMinutes: 60,
    });
    pushes.list = [];
    expect(
      await withRace(
        "update",
        `update coach_sessions set cancelled_at = now() where id = '${cancelled.data.id}'`,
        () => runAt("2027-03-24T08:15:00Z"),
      ),
    ).toEqual({ claimed: 0, sent: 0 });

    const removed = await book(COACH_A, {
      startsAt: "2027-03-25T09:00:00Z",
      clientIds: [ATHLETE_C],
      reminderMinutes: 60,
    });
    expect(
      await withRace(
        "update",
        `update coach_session_attendees set status = 'cancelled' where session_id = '${removed.data.id}'`,
        () => runAt("2027-03-25T08:15:00Z"),
      ),
    ).toEqual({ claimed: 0, sent: 0 });
    expect(reminders()).toHaveLength(0);
  });

  it("runs as the last job of coachSchedulerCron", () => {
    expect(COACH_SCHEDULER_JOBS.at(-1)).toBe(sessionRemindersJob);
    expect(sessionRemindersJob.cadence).toBe("tick");
  });

  it("athlete pushes come back from GET /notifications in the shape 1.2.0 parses", async () => {
    await book(COACH_A, { startsAt: FUTURE, clientIds: [ATHLETE_C] });
    const list = await http("GET", "/notifications", ATHLETE_C);
    expect(list.status).toBe(200);
    expect(list.json.rows[0]).toMatchObject({
      id: expect.any(String),
      type: "coach_session",
      title: expect.any(String),
      message: expect.any(String),
      data: { action: "booked" },
      createdAt: expect.any(String),
    });
    expect(list.json.rows[0].data.deepLink).toBeUndefined();
  });
});

// ─── Migration ───────────────────────────────────────────────────────────────

describe(MIGRATION, () => {
  it("applies twice, rolls back and re-applies, with RLS on and the checks enforced", async () => {
    const fresh = await baseDatabase();
    try {
      const sql = await read(MIGRATIONS, MIGRATION);
      await fresh.exec(sql);
      await fresh.exec(sql);
      const values = await fresh.query<{ v: string }>(
        "select unnest(enum_range(null::notification_type))::text as v",
      );
      expect(values.rows.map((r) => r.v)).toContain("coach_session");
      const rls = await fresh.query<{
        relname: string;
        relrowsecurity: boolean;
      }>(
        `select relname, relrowsecurity from pg_class
          where relname in ('coach_sessions','coach_session_attendees')
          order by relname`,
      );
      expect(rls.rows).toEqual([
        { relname: "coach_session_attendees", relrowsecurity: true },
        { relname: "coach_sessions", relrowsecurity: true },
      ]);
      await fresh.exec(await read(ROLLBACKS, MIGRATION));
      const gone = await fresh.query(
        "select 1 from pg_class where relname in ('coach_sessions','coach_session_attendees')",
      );
      expect(gone.rows).toHaveLength(0);
      await fresh.exec(sql);
      const coach = randomUUID();
      await fresh.exec(`insert into profiles (id) values ('${coach}');`);
      const insert = (cols: string, vals: string) =>
        fresh.exec(
          `insert into coach_sessions (trainer_id, starts_at, duration_min, ${cols}) values ('${coach}', now(), 60, ${vals});`,
        );
      await insert("kind, client_request_id", "'video', 'k'");
      await expect(
        insert("kind, client_request_id", "'video', 'k'"),
      ).rejects.toThrow();
      await expect(insert("kind", "'party'")).rejects.toThrow();
      // Reminders are at least one scheduler tick (15 minutes).
      await expect(
        insert("kind, reminder_minutes", "'video', 14"),
      ).rejects.toThrow();
      await expect(
        insert("kind, reminder_minutes", "'video', 0"),
      ).rejects.toThrow();
      await insert("kind, reminder_minutes", "'video', 15");
      await expect(
        insert("kind, video_url", "'video', 'http://x'"),
      ).rejects.toThrow();
      await expect(
        fresh.exec(
          `insert into coach_sessions (trainer_id, starts_at, duration_min, kind) values ('${coach}', now(), 1, 'video');`,
        ),
      ).rejects.toThrow();
    } finally {
      await fresh.close();
    }
  });
});
