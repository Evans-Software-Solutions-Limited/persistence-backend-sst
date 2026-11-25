import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { and, asc, eq, is, SQL } from "drizzle-orm";
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
 * PER-112 (BE-G1b) — design G part 2, programmes in order with Next and no
 * dates, end to end: the real handlers and repositories on PGlite carrying the
 * shipped migration. Only the edges are stubbed: the JWT (bearer token = user
 * id), push delivery and the coach seat evaluator (own suites).
 *
 * Covers design G part 2's tests: sequence assignments create ordered
 * workouts with no due dates; Next moves as sessions complete, including out
 * of order; dated assignments behave as before (the existing
 * scheduling.test.ts is unchanged); offboarding still removes only this
 * coach's assignments; the migration runs forward twice, down and up, with
 * existing rows unchanged. Plus "Me" (own programmes only), the design A set-up section, the read
 * fields, the indefinite top-up, programme_ending and two-user isolation.
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
vi.mock("../../notifications/push/notificationDispatcher", () => ({
  NotificationDispatcher: class {
    createAndDispatch = vi.fn(async () => ({}));
    dispatchExisting = vi.fn(async () => {});
  },
}));
vi.mock("../../trainers/seats/trainerSeats", async (original) => ({
  ...(await original<object>()),
  evaluateTrainerJoinSeat: async () => ({ allowed: true }),
  assertTrainerCanInvite: async () => {},
  notifyTrainerClientLimitReached: vi.fn(async () => {}),
}));

import Elysia from "elysia";
import { coreErrorHandler } from "../../../shared/errorHandler";
import { coachingRoutes } from "../../coachingRoutes";
import { trainersAcceptInviteCodeHandler } from "../../trainers/invite-codes/trainersAcceptInviteCodeHandler";
import { trainersProgramsAssignHandler } from "../../trainers/programs/trainersProgramsAssignHandler";
import { trainersProgramsUnassignHandler } from "../../trainers/programs/trainersProgramsUnassignHandler";
import { trainersProgramsGetHandler } from "../../trainers/programs/trainersProgramsGetHandler";
import { trainersClientActiveProgrammeGetHandler } from "../../trainers/programs/trainersClientActiveProgrammeGetHandler";
import { programsAthleteRoutes } from "../programsAthleteRoutes";
import { ProgramAssignmentRepository } from "../../repositories/programAssignmentRepository";
import { HomeReadRepository } from "../../repositories/homeReadRepository";
import { DashboardRepository } from "../../repositories/dashboardRepository";
import { CoachingAggregateRepository } from "../../repositories/coachingAggregateRepository";
import { endCoachClientRelationship } from "../../relationships/endCoachClientRelationship";
import { currentDeclarationVersion } from "../../coaching/declaration";
import { programmeEndingJob } from "../../coaching/scheduler/jobs/coachChecks";
import { PAGE_SIZES } from "../../coaching/scheduler/jobs/pageSizes";
import { NotificationDispatcher } from "../../notifications/push/notificationDispatcher";
import { assignProgrammeInSequence } from "../assignProgrammeInSequence";
import { loadSequenceProgress } from "../sequenceProgress";
import { addDays } from "../scheduling";

const MIGRATIONS = "../../../../../../supabase/migrations/";
const ROLLBACKS = "../../../../../../supabase/rollbacks/";
const read = (dir: string, file: string) =>
  readFile(new URL(`${dir}${file}`, import.meta.url), "utf8");
const MIGRATION = "20261125101831_programme_sequence_mode.sql";

const dialect = new PgDialect();

const BASE_TABLES = [
  schema.profiles,
  schema.ptClientRelationships,
  schema.dataSharingConsents,
  schema.trainerClientNotes,
  schema.nutritionTargets,
  schema.notifications,
  schema.trainerActionsAudit,
  schema.clientDataAccessLog,
  schema.workouts,
  schema.workoutPrograms,
  schema.programWorkouts,
  schema.programAssignments,
  schema.workoutAssignments,
  schema.clientAiSummaries,
  schema.nutritionPlans,
  schema.nutritionPlanAssignments,
  // PER-122: offboarding also removes this coach's resource assignments.
  schema.coachResources,
  schema.coachResourceAssignments,
  schema.habitConfigs,
  schema.userGoals,
  schema.goalTypes,
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

/** The programme tables as they were BEFORE this migration. */
async function baseDatabase(): Promise<PGlite> {
  const pg = await PGlite.create();
  await pg.exec(
    "create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';",
  );
  for (const table of BASE_TABLES) await pg.exec(ddl(table));
  // The Drizzle mirror already carries this migration's two columns.
  await pg.exec(
    "alter table program_assignments drop column schedule_mode; alter table workout_assignments drop column sequence_index;",
  );
  // The partial unique indexes the real programmes migration created.
  await pg.exec(
    `create unique index program_assignments_live_uq on program_assignments (program_id, client_id) where status in ('assigned', 'started');
     create unique index workout_assignments_pa_occurrence_uq on workout_assignments (program_assignment_id, occurrence_index) where program_assignment_id is not null;`,
  );
  await pg.exec(
    "alter table pt_client_relationships drop column activated_at, drop column client_profile_id;",
  );
  await pg.exec(
    await read(MIGRATIONS, "20260626110000_trainer_invite_codes.sql"),
  );
  return pg;
}

const COACH_A = randomUUID();
const COACH_B = randomUUID();
const ATHLETE_C = randomUUID();
const ATHLETE_E = randomUUID();
const ATHLETE_F = randomUUID();
const W_A = randomUUID();
const W_B = randomUUID();
const W_C = randomUUID();

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const repo = new ProgramAssignmentRepository();
const today = () => new Date().toISOString().slice(0, 10);

const app = new Elysia()
  .use(coreErrorHandler)
  .use(coachingRoutes)
  .use(trainersAcceptInviteCodeHandler)
  .use(trainersProgramsAssignHandler)
  .use(trainersProgramsUnassignHandler)
  .use(trainersProgramsGetHandler)
  .use(trainersClientActiveProgrammeGetHandler)
  .use(programsAthleteRoutes);

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

/** A programme owned by `owner` cycling `cycle`. */
async function makeProgram(
  owner: string,
  opts: {
    durationWeeks?: number | null;
    daysPerWeek?: number;
    cycle?: string[];
    isPublic?: boolean;
    name?: string;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.workoutPrograms).values({
    id,
    name: opts.name ?? "Block 1",
    createdBy: owner,
    durationWeeks: opts.durationWeeks === undefined ? 2 : opts.durationWeeks,
    daysPerWeek: opts.daysPerWeek ?? 3,
    isPublic: opts.isPublic ?? false,
  });
  const cycle = opts.cycle ?? [W_A, W_B, W_C];
  if (cycle.length > 0) {
    await db.insert(schema.programWorkouts).values(
      cycle.map((workoutId, position) => ({
        programId: id,
        workoutId,
        position,
      })),
    );
  }
  return id;
}

/** The workouts of a programme assignment, in programme order. */
async function workoutsOf(programAssignmentId: string) {
  return db
    .select({
      id: schema.workoutAssignments.id,
      workoutId: schema.workoutAssignments.workoutId,
      dueDate: schema.workoutAssignments.dueDate,
      sequenceIndex: schema.workoutAssignments.sequenceIndex,
      occurrenceIndex: schema.workoutAssignments.occurrenceIndex,
      status: schema.workoutAssignments.status,
      trainerId: schema.workoutAssignments.trainerId,
    })
    .from(schema.workoutAssignments)
    .where(
      eq(schema.workoutAssignments.programAssignmentId, programAssignmentId),
    )
    .orderBy(
      asc(schema.workoutAssignments.occurrenceIndex),
      asc(schema.workoutAssignments.dueDate),
    );
}

async function assignNoDate(programId: string, clientId = ATHLETE_C) {
  const res = await http(
    "POST",
    `/trainers/me/programs/${programId}/assign`,
    COACH_A,
    { clientId },
  );
  expect(res.status).toBe(201);
  return res.json.data as Json;
}

const complete = (clientId: string, workoutId: string) =>
  repo.linkCompletedSession(clientId, workoutId, randomUUID());

beforeAll(async () => {
  pg = await baseDatabase();
  await pg.exec(
    await read(
      MIGRATIONS,
      "20261120120000_coaching_relationships_client_profiles.sql",
    ),
  );
  await pg.exec(await read(MIGRATIONS, "20261120235941_coach_forms.sql"));
  await pg.exec(
    "DO $$ BEGIN CREATE TYPE notification_type AS ENUM ('coach_brief'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  );
  await pg.exec(
    await read(MIGRATIONS, "20261123120117_coach_events_notifications.sql"),
  );
  await pg.exec(await read(MIGRATIONS, MIGRATION));
  db = drizzle(pg, { schema });
  holder.db = db;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  const tables = [
    "coach_events",
    "coach_form_responses",
    "coach_form_requests",
    "coach_form_schedule_clients",
    "coach_form_schedules",
    "coach_form_versions",
    "coach_forms",
    "trainer_declarations",
    "coach_client_settings",
    "coach_client_setup_items",
    "trainer_invite_codes",
    "coach_client_profiles",
    ...BASE_TABLES.map((t) => getTableConfig(t).name),
  ];
  await pg.exec(`truncate ${tables.map((t) => `"${t}"`).join(",")} cascade`);
  await db.insert(schema.profiles).values([
    { id: COACH_A, fullName: "Ellie", role: "personal_trainer" },
    { id: COACH_B, fullName: "Marcus", role: "physiotherapist" },
    { id: ATHLETE_C, fullName: "Chris", role: "user" },
    { id: ATHLETE_E, fullName: "Lena Park", role: "user" },
    { id: ATHLETE_F, fullName: "Frankie", role: "user" },
  ]);
  await db.insert(schema.ptClientRelationships).values([
    { trainerId: COACH_A, clientId: ATHLETE_C, status: "active" },
    { trainerId: COACH_B, clientId: ATHLETE_C, status: "active" },
  ]);
  await db.insert(schema.workouts).values([
    { id: W_A, name: "Upper", createdBy: COACH_A },
    { id: W_B, name: "Lower", createdBy: COACH_A },
    { id: W_C, name: "Full", createdBy: COACH_A },
  ]);
});

// ─── Sequence assignments ────────────────────────────────────────────────────

describe("coach Assign with no start date (sequence)", () => {
  it("creates every workout once, undated, in programme order", async () => {
    const program = await makeProgram(COACH_A, {
      durationWeeks: 2,
      daysPerWeek: 3,
    });
    const assignment = await assignNoDate(program);
    expect(assignment).toMatchObject({
      scheduleMode: "sequence",
      startDate: today(),
      endDate: null,
      status: "assigned",
      assignedBy: COACH_A,
    });
    const rows = await workoutsOf(assignment.id);
    expect(rows).toHaveLength(6); // 2 weeks × 3 a week, as dated
    expect(rows.map((r) => r.sequenceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.occurrenceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.workoutId)).toEqual([
      W_A,
      W_B,
      W_C,
      W_A,
      W_B,
      W_C,
    ]);
    expect(rows.every((r) => r.dueDate === null)).toBe(true);
  });

  it("a start date (1.2.0 coach bundles) still assigns dated, exactly as before", async () => {
    const program = await makeProgram(COACH_A);
    const res = await http(
      "POST",
      `/trainers/me/programs/${program}/assign`,
      COACH_A,
      { clientId: ATHLETE_C, startDate: "2026-12-07" },
    );
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({
      scheduleMode: "dated",
      startDate: "2026-12-07",
      endDate: "2026-12-20",
    });
    const rows = await workoutsOf(res.json.data.id);
    expect(rows.map((r) => r.dueDate)).toEqual([
      "2026-12-07",
      "2026-12-09",
      "2026-12-12",
      "2026-12-14",
      "2026-12-16",
      "2026-12-19",
    ]);
    expect(rows.every((r) => r.sequenceIndex === null)).toBe(true);
    const active = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/active-programme`,
      COACH_A,
    );
    expect(active.json.data).toMatchObject({
      scheduleMode: "dated",
      nextAssignmentId: null,
      weekOfProgramme: { week: active.json.data.week, of: 2 },
    });
  });

  it("keeps the existing errors: 403 not your client, 404 not yours, 409 live, 422 empty", async () => {
    const mine = await makeProgram(COACH_A);
    const theirs = await makeProgram(COACH_B);
    const empty = await makeProgram(COACH_A, { cycle: [] });
    const assign = (programId: string, clientId: string) =>
      http("POST", `/trainers/me/programs/${programId}/assign`, COACH_A, {
        clientId,
      });
    expect((await assign(mine, ATHLETE_F)).status).toBe(403);
    expect((await assign(theirs, ATHLETE_C)).status).toBe(404);
    expect((await assign(empty, ATHLETE_C)).json).toMatchObject({
      code: "PROGRAM_EMPTY",
    });
    expect((await assign(mine, ATHLETE_C)).status).toBe(201);
    expect((await assign(mine, ATHLETE_C)).status).toBe(409);
  });
});

describe("Next", () => {
  it("moves as sessions complete, including out of order, and the programme completes", async () => {
    const program = await makeProgram(COACH_A, {
      durationWeeks: 1,
      daysPerWeek: 3,
    });
    const assignment = await assignNoDate(program);
    const rows = await workoutsOf(assignment.id);
    const active = async () =>
      (
        await http(
          "GET",
          `/trainers/me/clients/${ATHLETE_C}/active-programme`,
          COACH_A,
        )
      ).json.data;

    expect(await active()).toMatchObject({
      scheduleMode: "sequence",
      nextAssignmentId: rows[0]!.id,
      weekOfProgramme: { week: 1, of: 1 },
      totalWeeks: 1,
      endDate: null,
    });

    // Out of order: doing the third workout first leaves Next on the first.
    await complete(ATHLETE_C, W_C);
    expect((await active()).nextAssignmentId).toBe(rows[0]!.id);
    expect((await workoutsOf(assignment.id))[2]!.status).toBe("completed");

    await complete(ATHLETE_C, W_A);
    expect((await active()).nextAssignmentId).toBe(rows[1]!.id);

    // Last one done: the programme completes and drops off the Home card.
    await complete(ATHLETE_C, W_B);
    expect(await active()).toBeNull();
    const [pa] = await db
      .select()
      .from(schema.programAssignments)
      .where(eq(schema.programAssignments.id, assignment.id));
    expect(pa!.status).toBe("completed");
  });

  it("with the same workout in a dated programme too, Next is linked before a dated row that isn't due yet", async () => {
    // Inspector Brad, #564: a future dated occurrence must not swallow Next.
    const dated = await makeProgram(COACH_A, {
      durationWeeks: null, // indefinite: 28 days of future rows
      daysPerWeek: 1,
      cycle: [W_A],
      name: "Dated",
    });
    const sequence = await makeProgram(COACH_A, {
      durationWeeks: 1,
      daysPerWeek: 2,
      cycle: [W_A, W_B],
      name: "Sequence",
    });
    const res = await http(
      "POST",
      `/trainers/me/programs/${dated}/assign`,
      COACH_A,
      { clientId: ATHLETE_C, startDate: addDays(today(), 1) },
    );
    expect(res.status).toBe(201);
    const datedRows = await workoutsOf(res.json.data.id);
    expect(datedRows.length).toBeGreaterThan(1);
    expect(datedRows.every((r) => r.dueDate! > today())).toBe(true);
    const seq = await assignNoDate(sequence);
    const seqRows = await workoutsOf(seq.id);

    await complete(ATHLETE_C, W_A);
    expect((await workoutsOf(seq.id)).map((r) => r.status)).toEqual([
      "completed",
      "assigned",
    ]);
    expect(
      (await workoutsOf(res.json.data.id)).every(
        (r) => r.status === "assigned",
      ),
    ).toBe(true);
    // Next has moved on in the sequence programme.
    const progress = await loadSequenceProgress(db as never, [seq.id]);
    expect(progress.get(seq.id)?.nextAssignmentId).toBe(seqRows[1]!.id);
  });

  it("a dated row due today still comes before the sequence's Next", async () => {
    const dated = await makeProgram(COACH_A, {
      durationWeeks: 1,
      daysPerWeek: 1,
      cycle: [W_A],
      name: "Dated",
    });
    const sequence = await makeProgram(COACH_A, {
      durationWeeks: 1,
      daysPerWeek: 1,
      cycle: [W_A],
      name: "Sequence",
    });
    const res = await http(
      "POST",
      `/trainers/me/programs/${dated}/assign`,
      COACH_A,
      { clientId: ATHLETE_C, startDate: today() },
    );
    const seq = await assignNoDate(sequence);
    await complete(ATHLETE_C, W_A);
    expect((await workoutsOf(res.json.data.id))[0]!.status).toBe("completed");
    expect((await workoutsOf(seq.id))[0]!.status).toBe("assigned");
  });

  it("weekOfProgramme follows Next, not the calendar", async () => {
    const program = await makeProgram(COACH_A, {
      durationWeeks: 3,
      daysPerWeek: 2,
      cycle: [W_A, W_B],
    });
    const assignment = await assignNoDate(program);
    for (let i = 0; i < 2; i++) await complete(ATHLETE_C, i ? W_B : W_A);
    const home = new HomeReadRepository();
    const card = await home.getActiveProgramme(ATHLETE_C, today());
    expect(card).toMatchObject({
      week: 1, // calendar week, unchanged meaning for old bundles
      weekOfProgramme: { week: 2, of: 3 },
    });
    const rows = await workoutsOf(assignment.id);
    expect(card!.nextAssignmentId).toBe(rows[2]!.id);
  });

  it("Home and the dashboard show only Next of a sequence programme, beside dated and ad-hoc rows", async () => {
    const program = await makeProgram(COACH_A, { durationWeeks: 4 });
    const assignment = await assignNoDate(program);
    await repo.createAdHoc(COACH_A, ATHLETE_C, { workoutId: W_B }, today());
    const rows = await workoutsOf(assignment.id);

    const home = new HomeReadRepository();
    let training = await home.getTodaysTraining(ATHLETE_C, today());
    const fromProgramme = training.filter((t) => t.sequenceIndex !== undefined);
    expect(fromProgramme).toEqual([
      expect.objectContaining({
        assignmentId: rows[0]!.id,
        workoutId: W_A,
        dueDate: null,
        sequenceIndex: 0,
      }),
    ]);
    // The 1.2.0 shape is intact.
    for (const item of training) {
      expect(Object.keys(item)).toEqual(
        expect.arrayContaining([
          "assignmentId",
          "workoutId",
          "name",
          "estimatedDurationMinutes",
          "dueDate",
          "assignedByType",
          "assignedByName",
        ]),
      );
    }
    expect(training).toHaveLength(2);

    await complete(ATHLETE_C, W_A);
    training = await home.getTodaysTraining(ATHLETE_C, today());
    expect(
      training
        .filter((t) => t.sequenceIndex !== undefined)
        .map((t) => t.assignmentId),
    ).toEqual([rows[1]!.id]);

    const dashboard = await new DashboardRepository().getRecentWorkouts(
      ATHLETE_C,
    );
    // Next (Lower) and the ad-hoc row (also Lower) dedupe to one entry.
    expect(dashboard.filter((w) => w.isAssigned).map((w) => w.id)).toEqual([
      W_B,
    ]);
  });

  it("the coach's list and the relationship aggregate carry sequenceIndex, in programme order", async () => {
    const program = await makeProgram(COACH_A, { durationWeeks: 1 });
    await assignNoDate(program);
    // postgres.js returns raw `execute` rows as an array; PGlite wraps them.
    const execute = db.execute.bind(db);
    const spy = vi
      .spyOn(db, "execute")
      .mockImplementation(
        (async (query: Parameters<typeof execute>[0]) =>
          (await execute(query)).rows) as unknown as typeof db.execute,
      );
    const open = await repo.listOpenAssignmentsForClient(COACH_A, ATHLETE_C);
    expect(open.map((o) => o.sequenceIndex)).toEqual([0, 1, 2]);
    const aggregate = await new CoachingAggregateRepository().get(
      COACH_A,
      ATHLETE_C,
    );
    expect(aggregate.upcomingWorkouts.map((w) => w.sequenceIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(aggregate.activeProgramme).toMatchObject({
      scheduleMode: "sequence",
      weekOfProgramme: { week: 1, of: 1 },
    });
    spy.mockRestore();
  });

  it("the athlete's programme detail and the coach's programme read return the fields", async () => {
    const program = await makeProgram(COACH_A, { durationWeeks: 2 });
    const assignment = await assignNoDate(program);
    const rows = await workoutsOf(assignment.id);
    const athlete = await http("GET", `/programs/${program}`, ATHLETE_C);
    expect(athlete.status).toBe(200);
    expect(athlete.json.data).toMatchObject({
      scheduleMode: "sequence",
      nextAssignmentId: rows[0]!.id,
      weekOfProgramme: { week: 1, of: 2 },
      startDate: today(),
      endDate: null,
    });
    // Not assigned: still a 404 for anyone else.
    expect((await http("GET", `/programs/${program}`, ATHLETE_E)).status).toBe(
      404,
    );
    const coach = await http(
      "GET",
      `/trainers/me/programs/${program}`,
      COACH_A,
    );
    expect(coach.json.data.assignments[0]).toMatchObject({
      id: assignment.id,
      scheduleMode: "sequence",
      nextAssignmentId: rows[0]!.id,
      weekOfProgramme: { week: 1, of: 2 },
    });
  });
});

describe("indefinite sequence programmes", () => {
  it("keep four weeks of workouts open and top up idempotently", async () => {
    const program = await makeProgram(COACH_A, {
      durationWeeks: null,
      daysPerWeek: 2,
      cycle: [W_A, W_B],
    });
    const assignment = await assignNoDate(program);
    expect(await workoutsOf(assignment.id)).toHaveLength(8);
    await complete(ATHLETE_C, W_A);
    await complete(ATHLETE_C, W_B);
    await complete(ATHLETE_C, W_A);
    await repo.ensureMaterializedForClient(ATHLETE_C, today());
    await repo.ensureMaterializedForClient(ATHLETE_C, today());
    const rows = await workoutsOf(assignment.id);
    expect(rows).toHaveLength(11);
    expect(rows.map((r) => r.sequenceIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(rows.every((r) => r.dueDate === null)).toBe(true);
    expect(rows.filter((r) => r.status === "assigned")).toHaveLength(8);
    const card = await new HomeReadRepository().getActiveProgramme(
      ATHLETE_C,
      today(),
    );
    expect(card).toMatchObject({
      nextAssignmentId: rows[3]!.id,
      weekOfProgramme: { week: 2, of: null },
    });
  });
});

describe("unassign and offboarding", () => {
  it("unassign prunes every untouched sequence workout and keeps completed history", async () => {
    const program = await makeProgram(COACH_A);
    const assignment = await assignNoDate(program);
    await complete(ATHLETE_C, W_A);
    const res = await http(
      "DELETE",
      `/trainers/me/programs/${program}/assignments/${assignment.id}`,
      COACH_A,
    );
    expect(res.status).toBe(200);
    const rows = await workoutsOf(assignment.id);
    expect(rows.map((r) => r.status)).toEqual(["completed"]);
  });

  it("ending coach A removes only A's assignments, never B's or the athlete's own", async () => {
    const programA = await makeProgram(COACH_A);
    const programB = await makeProgram(COACH_B);
    await assignNoDate(programA);
    const fromB = await assignProgrammeInSequence({
      assignerId: COACH_B,
      clientId: ATHLETE_C,
      programId: programB,
      today: today(),
    });
    if (!("assignment" in fromB)) throw new Error("expected an assignment");

    await endCoachClientRelationship({
      trainerId: COACH_A,
      clientId: ATHLETE_C,
      initiatedBy: "trainer",
    });

    const left = await db
      .select({ assignedBy: schema.programAssignments.assignedBy })
      .from(schema.programAssignments)
      .where(eq(schema.programAssignments.clientId, ATHLETE_C));
    expect(left).toEqual([{ assignedBy: COACH_B }]);
    const workouts = await workoutsOf(fromB.assignment.id);
    expect(workouts).toHaveLength(6);
    expect(workouts.every((w) => w.trainerId === COACH_B)).toBe(true);
  });
});

// ─── "Me" ────────────────────────────────────────────────────────────────────

describe("POST /users/me/program-assignments (Me)", () => {
  const me = (actor: string, programId: string) =>
    http("POST", "/users/me/program-assignments", actor, { programId });

  it("a coach assigns their own programme to themselves, in sequence, with no relationship", async () => {
    const program = await makeProgram(COACH_A);
    const res = await me(COACH_A, program);
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({
      clientId: COACH_A,
      assignedBy: COACH_A,
      scheduleMode: "sequence",
      startDate: today(),
      endDate: null,
    });
    const rows = await workoutsOf(res.json.data.id);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.dueDate === null)).toBe(true);
    const selfRelationships = await db
      .select()
      .from(schema.ptClientRelationships)
      .where(eq(schema.ptClientRelationships.clientId, COACH_A));
    expect(selfRelationships).toEqual([]);
    // It shows on their own Home card.
    const card = await new HomeReadRepository().getActiveProgramme(
      COACH_A,
      today(),
    );
    expect(card).toMatchObject({
      programId: program,
      scheduleMode: "sequence",
    });
  });

  it("a re-sent request returns the first row, not a duplicate", async () => {
    const program = await makeProgram(COACH_A);
    const first = await me(COACH_A, program);
    const again = await me(COACH_A, program);
    expect(again.status).toBe(200);
    expect(again.json.data.id).toBe(first.json.data.id);
    const all = await db
      .select()
      .from(schema.programAssignments)
      .where(eq(schema.programAssignments.clientId, COACH_A));
    expect(all).toHaveLength(1);
  });

  it("accepts only the caller's own programme: another trainer's, public or private, is a 404 like an unknown id", async () => {
    // Design G's "or public" is deferred pending Brad (Inspector Brad, #564).
    const publicOne = await makeProgram(COACH_B, { isPublic: true });
    const privateOne = await makeProgram(COACH_B);
    for (const programId of [publicOne, privateOne, randomUUID()]) {
      const res = await me(COACH_A, programId);
      expect([res.status, res.json?.code]).toEqual([404, "not_found"]);
    }
    expect(await db.select().from(schema.programAssignments)).toEqual([]);
    expect(await db.select().from(schema.workoutAssignments)).toEqual([]);
    // The caller's own programme still works.
    const own = await makeProgram(COACH_A);
    expect((await me(COACH_A, own)).status).toBe(201);
  });

  it("a live copy of your programme from someone else is a 409; an empty one is a 422", async () => {
    // Not reachable through the API today (only an owner can assign their
    // programme), so the row is written directly.
    const program = await makeProgram(COACH_A);
    await db.insert(schema.programAssignments).values({
      programId: program,
      clientId: COACH_A,
      assignedBy: COACH_B,
      startDate: today(),
      status: "assigned",
    });
    expect((await me(COACH_A, program)).json).toMatchObject({
      code: "already_assigned",
    });
    const empty = await makeProgram(COACH_A, { cycle: [] });
    expect((await me(COACH_A, empty)).status).toBe(422);
  });

  it("is 403 without the trainer role and 401 without a token", async () => {
    const program = await makeProgram(COACH_A);
    const res = await me(ATHLETE_C, program);
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ code: "planning_not_available" });
    expect((await me("", program)).status).toBe(401);
    const none = await db.select().from(schema.programAssignments);
    expect(none).toEqual([]);
  });
});

// ─── Design A set-up ─────────────────────────────────────────────────────────

describe("set-up section: programme", () => {
  async function newProfile() {
    const res = await http("POST", "/trainers/me/client-profiles", COACH_A, {
      displayName: "Lena",
    });
    expect(res.status).toBe(201);
    return res.json.data as Json;
  }
  const put = (profileId: string, items: unknown[]) =>
    http(
      "PUT",
      `/trainers/me/client-profiles/${profileId}/setup/programme`,
      COACH_A,
      { items },
    );

  it("validates: the coach's own, non-empty programme and a sane sessions target", async () => {
    const profile = await newProfile();
    const theirs = await makeProgram(COACH_B);
    const empty = await makeProgram(COACH_A, { cycle: [] });
    const mine = await makeProgram(COACH_A);
    const bad: unknown[][] = [
      [{ sortOrder: 0, config: {} }],
      [{ refId: theirs, sortOrder: 0, config: {} }],
      [{ refId: empty, sortOrder: 0, config: {} }],
      [{ refId: mine, sortOrder: 0, config: { sessionsPerWeek: 0 } }],
      [{ refId: mine, sortOrder: 0, config: { sessionsPerWeek: 2.5 } }],
    ];
    for (const items of bad) {
      const res = await put(profile.id, items);
      expect([res.status, res.json?.code]).toEqual([400, "invalid_setup"]);
    }
    const ok = await put(profile.id, [
      {
        refId: mine,
        sortOrder: 0,
        config: { sessionsPerWeek: 3, ignored: true },
      },
    ]);
    expect([ok.status, ok.json?.message]).toEqual([200, undefined]);
    const items = await db
      .select()
      .from(schema.coachClientSetupItems)
      .where(eq(schema.coachClientSetupItems.profileId, profile.id));
    expect(items.map((i) => i.config)).toEqual([{ sessionsPerWeek: 3 }]);
  });

  it("previews, then on accept becomes one sequence assignment from the coach", async () => {
    const profile = await newProfile();
    const program = await makeProgram(COACH_A, { name: "Base block" });
    expect(
      (await put(profile.id, [{ refId: program, sortOrder: 0, config: {} }]))
        .status,
    ).toBe(200);
    const preview = await http(
      "GET",
      `/trainers/me/client-profiles/${profile.id}/preview`,
      COACH_A,
    );
    expect(preview.json.data.programmes).toEqual([
      { name: "Base block", workouts: 3 },
    ]);

    await http("POST", "/trainers/me/declaration", COACH_A, {
      statementVersion: currentDeclarationVersion(),
    });
    const invite = await http(
      "POST",
      `/trainers/me/client-profiles/${profile.id}/invite`,
      COACH_A,
    );
    expect(invite.status).toBe(201);
    const accepted = await http(
      "POST",
      "/trainers/accept-invite-code",
      ATHLETE_E,
      {
        code: invite.json.data.code,
        consent: true,
        consentVersion: "v1-2026-07",
      },
    );
    expect(accepted.status).toBeLessThan(300);

    const assignments = await db
      .select()
      .from(schema.programAssignments)
      .where(
        and(
          eq(schema.programAssignments.clientId, ATHLETE_E),
          eq(schema.programAssignments.programId, program),
        ),
      );
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      assignedBy: COACH_A,
      scheduleMode: "sequence",
      endDate: null,
    });
    const rows = await workoutsOf(assignments[0]!.id);
    expect(rows.map((r) => r.sequenceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    const [item] = await db
      .select()
      .from(schema.coachClientSetupItems)
      .where(eq(schema.coachClientSetupItems.profileId, profile.id));
    expect(item!.materialisedRefId).toBe(assignments[0]!.id);
  });

  it("copy-from brings this coach's live programmes for an active client, never another coach's", async () => {
    const mine = await makeProgram(COACH_A, { name: "Mine" });
    const theirs = await makeProgram(COACH_B, { name: "Theirs" });
    await assignNoDate(mine);
    await assignProgrammeInSequence({
      assignerId: COACH_B,
      clientId: ATHLETE_C,
      programId: theirs,
      today: today(),
    });
    const profile = await newProfile();
    const res = await http(
      "POST",
      `/trainers/me/client-profiles/${profile.id}/setup/copy-from`,
      COACH_A,
      { sourceClientId: ATHLETE_C, sections: ["programme"] },
    );
    expect(res.status).toBe(200);
    const items = await db
      .select()
      .from(schema.coachClientSetupItems)
      .where(eq(schema.coachClientSetupItems.profileId, profile.id));
    expect(items.map((i) => [i.section, i.refId])).toEqual([
      ["programme", mine],
    ]);
  });
});

// ─── programme_ending ────────────────────────────────────────────────────────

describe("programme_ending for sequence programmes", () => {
  it("fires once when two or fewer workouts remain, never for indefinite ones", async () => {
    const finite = await makeProgram(COACH_A, {
      durationWeeks: 1,
      daysPerWeek: 3,
    });
    const ongoing = await makeProgram(COACH_A, {
      durationWeeks: null,
      daysPerWeek: 1,
      cycle: [W_A],
    });
    await assignNoDate(finite);
    await assignNoDate(ongoing);
    const ctx = () => ({
      now: new Date(),
      dispatcher: new NotificationDispatcher(),
    });
    const events = () =>
      db
        .select()
        .from(schema.coachEvents)
        .where(eq(schema.coachEvents.kind, "programme_ending"));

    await programmeEndingJob.run(ctx());
    expect(await events()).toHaveLength(0); // three left

    await complete(ATHLETE_C, W_B);
    await programmeEndingJob.run(ctx());
    await programmeEndingJob.run(ctx());
    const fired = await events();
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      trainerId: COACH_A,
      clientId: ATHLETE_C,
      dedupeKey: expect.stringMatching(/:sequence$/),
    });
    expect(fired[0]!.payload).toMatchObject({ remaining: 2, endDate: null });
  });

  it("pages through every ending programme in one run", async () => {
    const saved = PAGE_SIZES.endingProgrammes;
    PAGE_SIZES.endingProgrammes = 1;
    try {
      await db.insert(schema.ptClientRelationships).values({
        trainerId: COACH_A,
        clientId: ATHLETE_E,
        status: "active",
      });
      const program = await makeProgram(COACH_A, {
        durationWeeks: 1,
        daysPerWeek: 2,
        cycle: [W_A, W_B],
      });
      await assignNoDate(program, ATHLETE_C);
      await assignNoDate(program, ATHLETE_E);
      const result = await programmeEndingJob.run({
        now: new Date(),
        dispatcher: new NotificationDispatcher(),
      });
      expect(result).toEqual({ checked: 2, events: 2 });
    } finally {
      PAGE_SIZES.endingProgrammes = saved;
    }
  });
});

// ─── Migration ───────────────────────────────────────────────────────────────

describe("migration 20261125101831_programme_sequence_mode", () => {
  it("runs forward twice, down and up; existing rows stay dated and unchanged", async () => {
    const m = await baseDatabase();
    const forward = await read(MIGRATIONS, MIGRATION);
    const rollback = await read(ROLLBACKS, MIGRATION);
    const pa = randomUUID();
    await m.exec(
      `insert into program_assignments (id, program_id, client_id, assigned_by, start_date, end_date, status)
         values ('${pa}', '${randomUUID()}', '${ATHLETE_C}', '${COACH_A}', '2026-11-02', '2026-11-29', 'started');
       insert into workout_assignments (trainer_id, client_id, workout_id, assigned_date, due_date, status, program_assignment_id, occurrence_index)
         values ('${COACH_A}', '${ATHLETE_C}', '${W_A}', '2026-11-02', '2026-11-02', 'completed', '${pa}', 0);`,
    );
    const snapshot = async () => ({
      pa: (
        await m.query(
          "select start_date, end_date, status from program_assignments",
        )
      ).rows,
      wa: (
        await m.query(
          "select due_date, status, occurrence_index from workout_assignments",
        )
      ).rows,
    });
    const before = await snapshot();

    await m.exec(forward);
    await m.exec(forward);
    expect(await snapshot()).toEqual(before);
    const modes = await m.query<{ schedule_mode: string }>(
      "select schedule_mode from program_assignments",
    );
    expect(modes.rows).toEqual([{ schedule_mode: "dated" }]);
    const seq = await m.query<{ sequence_index: number | null }>(
      "select sequence_index from workout_assignments",
    );
    expect(seq.rows).toEqual([{ sequence_index: null }]);
    await expect(
      m.exec(`update program_assignments set schedule_mode = 'weekly'`),
    ).rejects.toThrow();

    await m.exec(rollback);
    const cols = await m.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where column_name in ('schedule_mode', 'sequence_index')`,
    );
    expect(cols.rows).toEqual([]);
    expect(await snapshot()).toEqual(before);

    await m.exec(forward);
    expect(
      (await m.query("select schedule_mode from program_assignments")).rows,
    ).toEqual([{ schedule_mode: "dated" }]);
    await m.close();
  });
});
