import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { is, SQL, eq } from "drizzle-orm";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import * as schema from "@persistence/db/schema";
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@persistence/db/client", () => ({ getDb: () => holder.db }));
import {
  TogetherRepository,
  revokePair,
  canReportTogether,
} from "../togetherRepository";
import { withActors } from "../shared";
import { placesRepository } from "../../places/placesRepository";
import { SessionRepository } from "../../repositories/sessionRepository";
import type { TogetherCommand } from "../types";
let pg: PGlite;
let db: ReturnType<typeof drizzle>;
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  exercise = randomUUID(),
  otherExercise = randomUUID();
const key = () => randomUUID();
const repo = new TogetherRepository();
const dialect = new PgDialect();
const legacy = [
  schema.profiles,
  schema.friendships,
  schema.subscriptionTiers,
  schema.userSubscriptions,
  schema.exercises,
  schema.workouts,
  schema.workoutSessions,
  schema.sessionExercises,
  schema.exerciseSets,
  schema.personalRecords,
  schema.workoutExercises,
  schema.programWorkouts,
  schema.programAssignments,
  schema.workoutAssignments,
  schema.userStreaks,
  schema.achievements,
  schema.userAchievements,
  schema.muscleGroups,
  schema.weeklyVolumePerUser,
  schema.volumeByMusclePerUser,
];
function ddl(table: PgTable) {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((c) => {
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
    cols.push(
      `primary key (${pk.columns.map((c) => `"${c.name}"`).join(",")})`,
    );
  return `create table "${cfg.name}" (${cols.join(",")});`;
}
const migration = readFileSync(
  new URL(
    "../../../../../../supabase/migrations/20260921211637_together_backend.sql",
    import.meta.url,
  ),
  "utf8",
);
beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec("create role anon;create role authenticated;");
  for (const table of legacy) await pg.exec(ddl(table));
  await pg.exec(
    "CREATE UNIQUE INDEX workout_sessions_user_client_session_idx ON workout_sessions(user_id,client_session_id);",
  );
  for (const table of legacy)
    for (const index of getTableConfig(table).indexes) {
      if (!index.config.unique) continue;
      const cols = index.config.columns.map((c) =>
        "name" in c ? `"${c.name}"` : null,
      );
      if (cols.some((c) => !c)) continue;
      await pg.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${index.config.name}" ON "${getTableConfig(table).name}" (${cols.join(",")})${index.config.where ? " WHERE " + dialect.sqlToQuery(index.config.where).sql : ""}`,
      );
    }
  await pg.exec(
    "CREATE TYPE record_type AS ENUM ('1rm','3rm','5rm','10rm','max_reps','max_weight','max_volume','best_time','longest_distance')",
  );
  await pg.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS exercises_client_key ON exercises(created_by,client_request_id); ALTER TABLE exercises ADD FOREIGN KEY(created_by) REFERENCES profiles(id) ON DELETE CASCADE;ALTER TABLE session_exercises ADD FOREIGN KEY(exercise_id) REFERENCES exercises(id) ON DELETE CASCADE;ALTER TABLE session_exercises ADD FOREIGN KEY(original_exercise_id) REFERENCES exercises(id) ON DELETE SET NULL;",
  );
  await pg.exec(migration);
  await pg.exec(migration);
  db = drizzle(pg, { schema });
  holder.db = db;
});
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(placesRepository, "resolve").mockResolvedValue({
    placeId: "geoapify:place",
    label: "Selected gym",
    center: { latitude: 51, longitude: 0 },
  });
  await pg.exec(
    `TRUNCATE profiles,exercises,subscription_tiers,user_subscriptions,friendships,workouts,workout_sessions,session_exercises,exercise_sets,personal_records,user_streaks,user_achievements,achievements,weekly_volume_per_user,volume_by_muscle_per_user CASCADE`,
  );
  await db.insert(schema.profiles).values([
    { id: a, fullName: "A" },
    { id: b, fullName: "B" },
    { id: c, fullName: "C" },
  ]);
  await db.insert(schema.subscriptionTiers).values({
    tierName: "premium",
    displayName: "Premium",
    priceMonthly: "10",
    priceYearly: "100",
  });
  await db.insert(schema.userSubscriptions).values(
    [a, b, c].map((userId) => ({
      userId,
      tierName: "premium",
      paymentStatus: "active" as never,
      startsAt: new Date(0),
    })),
  );
  await db.insert(schema.exercises).values([
    { id: exercise, name: "Squat" },
    { id: otherExercise, name: "Press" },
  ]);
  vi.stubEnv("TOGETHER_ENABLED", "true");
  vi.stubEnv(
    "TOGETHER_TOKEN_SECRET",
    "test-secret-at-least-thirty-two-characters",
  );
  vi.stubEnv("TOGETHER_WEBSOCKET_URL", "wss://test.invalid");
  vi.stubEnv("TOGETHER_DISCOVERY_ENABLED", "true");
});
afterAll(async () => {
  await pg.close();
  vi.unstubAllEnvs();
});
const plan = () => ({
  name: "Session",
  exercises: [
    { planExerciseId: key(), exerciseId: exercise, order: 0, targetSets: 3 },
  ],
});
async function create(
  ownExecution = { exercises: [] } as schema.TogetherExecution,
  p = plan(),
) {
  return {
    ...(await repo.create(a, key(), {
      clientDraftId: key(),
      plan: p,
      ownExecution,
    })),
    plan: p,
  };
}
async function pair() {
  const s = await create();
  const invite = await repo.invite(a, s.sessionId, key(), {
    expiresInMinutes: 15,
  });
  const req = await repo.requestJoin(b, key(), {
    inviteToken: invite.token,
    consentVersion: "together-v1",
    consentAccepted: true,
  });
  await repo.decide(a, s.sessionId, req.requestId, key(), {
    decision: "approve",
    expectedRevision: (await repo.snapshot(a, s.sessionId)).revision,
  });
  return s;
}
const set = (weightKg = 40) => ({
  setId: key(),
  reps: 8,
  weightKg,
  completed: true,
});
const cmd = (
  athlete: string,
  pid: string,
  expectedVersion = 0,
  operation: TogetherCommand["operation"] = {
    type: "upsertSet",
    planExerciseId: pid,
    set: set(),
  },
): TogetherCommand => ({
  commandId: key(),
  expectedVersion,
  target: { kind: "execution", athleteId: athlete },
  operation,
});
const run = (actor: string, id: string, body: TogetherCommand, k = key()) =>
  repo.command(actor, id, k, body);
describe("production Together persistence and recovery", () => {
  it("migration is rerunnable; promotion deduplicates by draft and blocks parallel drafts and solo completion", async () => {
    const body = {
      clientDraftId: key(),
      plan: plan(),
      ownExecution: { exercises: [] },
    };
    const k = key();
    const s = await repo.create(a, k, body);
    expect(await repo.create(a, k, body)).toEqual(s);
    expect((await repo.create(a, key(), body)).sessionId).toBe(s.sessionId);
    await expect(
      repo.create(a, key(), {
        ...body,
        plan: { ...body.plan, name: "Changed" },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await expect(create()).rejects.toMatchObject({
      code: "ACTIVE_SESSION_EXISTS",
    });
    await expect(
      new SessionRepository().recordSession(
        a,
        {
          clientSessionId: body.clientDraftId,
          startedAt: new Date().toISOString(),
          status: "completed",
          exercises: [],
        },
        async () => [],
      ),
    ).rejects.toMatchObject({ code: "DRAFT_PROMOTED" });
    expect((await repo.active(a)).data).toHaveLength(1);
    await expect(repo.snapshot(c, s.sessionId)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("validates plan identity/exercises and imported solo execution", async () => {
    const p = plan();
    await expect(
      repo.create(a, key(), {
        clientDraftId: key(),
        plan: { ...p, exercises: [p.exercises[0], p.exercises[0]] },
        ownExecution: { exercises: [] },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      create(
        { exercises: [] },
        { ...p, exercises: [{ ...p.exercises[0], exerciseId: key() }] },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      create({
        exercises: [{ planExerciseId: key(), skipped: false, sets: [] }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    const s = await create(
      {
        exercises: [
          {
            planExerciseId: p.exercises[0].planExerciseId,
            substituteExerciseId: otherExercise,
            skipped: false,
            sets: [set()],
          },
        ],
      },
      p,
    );
    expect(
      s.snapshot.participants[0].execution.exercises[0].everAcknowledged,
    ).toBe(true);
  });
  it("keeps invitations hashed even in receipts, replays deterministic tokens and requires current approval", async () => {
    const s = await create();
    const k = key();
    const invite = await repo.invite(a, s.sessionId, k, {
      expiresInMinutes: 15,
    });
    expect(
      await repo.invite(a, s.sessionId, k, { expiresInMinutes: 15 }),
    ).toEqual(invite);
    expect(
      JSON.stringify(await db.select().from(schema.togetherInvites)),
    ).not.toContain(invite.token);
    expect(
      JSON.stringify(await db.select().from(schema.togetherReceipts)),
    ).not.toContain(invite.token);
    await expect(
      repo.requestJoin(b, key(), {
        inviteToken: "invalid",
        consentVersion: "together-v1",
        consentAccepted: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const req = await repo.requestJoin(b, key(), {
      inviteToken: invite.token,
      consentVersion: "together-v1",
      consentAccepted: true,
    });
    expect((await repo.listRequests(a, s.sessionId)).data[0]).toMatchObject({
      userId: b,
      displayName: "B",
    });
    await expect(repo.snapshot(b, s.sessionId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      repo.decide(b, s.sessionId, req.requestId, key(), {
        decision: "approve",
        expectedRevision: (await repo.snapshot(a, s.sessionId)).revision,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      repo.decide(a, s.sessionId, req.requestId, key(), {
        decision: "approve",
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await repo.revokeInvite(a, s.sessionId, invite.tokenId, key());
    await expect(
      repo.decide(a, s.sessionId, req.requestId, key(), {
        decision: "approve",
        expectedRevision: (await repo.snapshot(a, s.sessionId)).revision,
      }),
    ).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
  });
  it("serializes concurrent seat approvals and preserves independent executions", async () => {
    const s = await create();
    const invite = await repo.invite(a, s.sessionId, key(), {
      expiresInMinutes: 15,
    });
    const requests = await Promise.all(
      [b, c].map((actor) =>
        repo.requestJoin(actor, key(), {
          inviteToken: invite.token,
          consentVersion: "together-v1",
          consentAccepted: true,
        }),
      ),
    );
    const results = await Promise.allSettled(
      requests.map(async (r) =>
        repo.decide(a, s.sessionId, r.requestId, key(), {
          decision: "approve",
          expectedRevision: (await repo.snapshot(a, s.sessionId)).revision,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const snap = await repo.snapshot(a, s.sessionId);
    expect(snap.participants).toHaveLength(2);
    expect(snap.participants[1].execution.exercises).toEqual([]);
  });
  it("accepts concurrent own actions without global conflict and deduplicates commands under different HTTP keys", async () => {
    const s = await pair();
    const pid = s.plan.exercises[0].planExerciseId;
    const ca = cmd(a, pid),
      cb = cmd(b, pid);
    await Promise.all([run(a, s.sessionId, ca), run(b, s.sessionId, cb)]);
    const before = (await repo.snapshot(a, s.sessionId)).revision;
    await run(a, s.sessionId, ca);
    expect((await repo.snapshot(a, s.sessionId)).revision).toBe(before);
    await expect(
      run(a, s.sessionId, { ...ca, operation: { type: "rest", endsAt: null } }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await expect(run(a, s.sessionId, cmd(a, pid))).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect((await repo.events(a, s.sessionId, 0)).data).toHaveLength(4);
  });
  it("revokes generation before dedup replies and rejects partner/self plan authority", async () => {
    const s = await pair();
    const pid = s.plan.exercises[0].planExerciseId;
    const command = cmd(b, pid);
    await expect(run(a, s.sessionId, command)).rejects.toMatchObject({
      code: "DELEGATION_REVOKED",
    });
    const grant = await repo.delegation(b, s.sessionId, key(), {
      allowPartnerLogging: true,
    });
    command.delegationGeneration = grant.generation;
    await run(a, s.sessionId, command);
    await repo.delegation(b, s.sessionId, key(), {
      allowPartnerLogging: false,
    });
    await expect(run(a, s.sessionId, command)).rejects.toMatchObject({
      code: "DELEGATION_REVOKED",
    });
    await expect(
      run(b, s.sessionId, {
        commandId: key(),
        expectedVersion: 1,
        target: { kind: "plan" },
        operation: { type: "replacePlan", plan: s.plan },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("holds identity tombstones through set removal and allows only unchanged substitution", async () => {
    const s = await pair();
    const pid = s.plan.exercises[0].planExerciseId;
    const sub = {
      type: "substitute" as const,
      planExerciseId: pid,
      exerciseId: otherExercise,
    };
    await run(b, s.sessionId, cmd(b, pid, 0, sub));
    const st = set();
    await run(
      b,
      s.sessionId,
      cmd(b, pid, 1, { type: "upsertSet", planExerciseId: pid, set: st }),
    );
    await run(
      b,
      s.sessionId,
      cmd(b, pid, 2, {
        type: "removeSet",
        planExerciseId: pid,
        setId: st.setId,
      }),
    );
    await run(b, s.sessionId, cmd(b, pid, 3, sub));
    await expect(
      run(b, s.sessionId, cmd(b, pid, 4, { ...sub, exerciseId: null })),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    const replace = (p: schema.TogetherPlan) =>
      run(a, s.sessionId, {
        commandId: key(),
        target: { kind: "plan" },
        expectedVersion: 1,
        operation: { type: "replacePlan", plan: p },
      });
    await expect(replace({ ...s.plan, exercises: [] })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(
      replace({
        ...s.plan,
        exercises: [{ ...s.plan.exercises[0], exerciseId: otherExercise }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await replace({
      ...s.plan,
      name: "Reordered",
      exercises: [{ ...s.plan.exercises[0], order: 1 }],
    });
  });
  it("supports own skip, rest, set updates and pre-ack substitution reset", async () => {
    const s = await create();
    const pid = s.plan.exercises[0].planExerciseId;
    await run(
      a,
      s.sessionId,
      cmd(a, pid, 0, {
        type: "substitute",
        planExerciseId: pid,
        exerciseId: null,
      }),
    );
    await run(
      a,
      s.sessionId,
      cmd(a, pid, 1, { type: "skip", planExerciseId: pid, skipped: true }),
    );
    await run(a, s.sessionId, cmd(a, pid, 2, { type: "rest", endsAt: null }));
    const st = set();
    await run(
      a,
      s.sessionId,
      cmd(a, pid, 3, { type: "upsertSet", planExerciseId: pid, set: st }),
    );
    await run(
      a,
      s.sessionId,
      cmd(a, pid, 4, {
        type: "upsertSet",
        planExerciseId: pid,
        set: { ...st, weightKg: 50 },
      }),
    );
    expect(
      (await repo.snapshot(a, s.sessionId)).participants[0].execution
        .exercises[0].sets[0].weightKg,
    ).toBe(50);
    await expect(run(a, s.sessionId, cmd(a, key(), 5))).rejects.toMatchObject({
      status: 400,
    });
  });
  it("block immediately restricts replay/snapshots/partner writes but preserves own pending work and reports", async () => {
    const s = await pair();
    const pid = s.plan.exercises[0].planExerciseId;
    await withActors([a, b], (tx) => revokePair(tx, a, b, "block"));
    expect((await repo.snapshot(a, s.sessionId)).participants).toHaveLength(1);
    await expect(repo.events(a, s.sessionId, 0)).rejects.toMatchObject({
      status: 403,
    });
    await expect(repo.ticket(a, s.sessionId, key())).rejects.toMatchObject({
      status: 403,
    });
    await run(b, s.sessionId, cmd(b, pid));
    expect(
      await withActors([a, b], (tx) =>
        canReportTogether(tx, a, b, s.sessionId),
      ),
    ).toBe(true);
    expect(
      await withActors([a, c], (tx) =>
        canReportTogether(tx, a, c, s.sessionId),
      ),
    ).toBe(false);
    expect(await withActors([a, b], (tx) => canReportTogether(tx, a, b))).toBe(
      false,
    );
    await repo.finish(b, s.sessionId, key(), { expectedOwnRevision: 1 });
  });
  it("expiry and paid loss keep personal recovery available but stop cooperation and discovery", async () => {
    const s = await pair();
    await db
      .delete(schema.userSubscriptions)
      .where(eq(schema.userSubscriptions.userId, b));
    expect((await repo.snapshot(b, s.sessionId)).participants).toHaveLength(1);
    await run(b, s.sessionId, cmd(b, s.plan.exercises[0].planExerciseId));
    await expect(
      repo.delegation(b, s.sessionId, key(), { allowPartnerLogging: true }),
    ).rejects.toMatchObject({ status: 403 });
    await db.update(schema.togetherSessions).set({ expiresAt: new Date(0) });
    await expect(
      repo.invite(a, s.sessionId, key(), { expiresInMinutes: 15 }),
    ).rejects.toMatchObject({ status: 403 });
    await repo.finish(a, s.sessionId, key(), { expectedOwnRevision: 0 });
    expect((await repo.snapshot(b, s.sessionId)).completion.status).toBe(
      "active",
    );
  });
  it("one-use tickets survive receipt retries and revoke consumption after leave; outbox retries stay durable", async () => {
    const s = await pair();
    const k = key();
    const ticket = await repo.ticket(b, s.sessionId, k);
    expect(await repo.ticket(b, s.sessionId, k)).toEqual(ticket);
    expect(
      JSON.stringify(await db.select().from(schema.togetherReceipts)),
    ).not.toContain(ticket.ticket);
    await repo.consumeTicket(ticket.ticket, "conn");
    await expect(
      repo.consumeTicket(ticket.ticket, "other"),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await withActors([a, b], (tx) =>
        repo.authorizeDelivery(tx, s.sessionId, b),
      ),
    ).toBe(true);
    await repo.finish(b, s.sessionId, key(), { expectedOwnRevision: 0 }, true);
    expect(
      await withActors([a, b], (tx) =>
        repo.authorizeDelivery(tx, s.sessionId, b),
      ),
    ).toBe(false);
    await repo.disconnect("conn");
    expect(await db.select().from(schema.togetherConnections)).toEqual([]);
    const pending = await repo.listPendingEvents();
    await repo.acknowledgeEvent(s.sessionId, pending[0].revision);
    expect((await repo.listPendingEvents()).length).toBe(pending.length - 1);
    expect(
      await withActors([a], (tx) => repo.authorizeDelivery(tx, key(), a)),
    ).toBe(false);
  });
  it("finish freezes each owner once, returns current completion and empty finish creates no history", async () => {
    const s = await pair();
    const pid = s.plan.exercises[0].planExerciseId;
    await run(a, s.sessionId, cmd(a, pid));
    await expect(
      repo.finish(a, s.sessionId, key(), { expectedOwnRevision: 0 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const k = key();
    expect(
      await repo.finish(a, s.sessionId, k, { expectedOwnRevision: 1 }),
    ).toMatchObject({ status: "pending" });
    expect(
      await repo.finish(a, s.sessionId, k, { expectedOwnRevision: 1 }),
    ).toMatchObject({ status: "pending" });
    await expect(run(a, s.sessionId, cmd(a, pid, 1))).rejects.toMatchObject({
      status: 409,
    });
    expect(await db.select().from(schema.togetherJobs)).toHaveLength(1);
    expect(
      await repo.finish(
        b,
        s.sessionId,
        key(),
        { expectedOwnRevision: 0 },
        true,
      ),
    ).toMatchObject({ status: "finished_empty" });
    expect((await repo.snapshot(a, s.sessionId)).state).toBe("closed");
  });
  it("visibility and discovery restrict friends/private, cursor scope and nearby place selection", async () => {
    const s = await create();
    await expect(
      repo.requestJoin(b, key(), {
        sessionId: s.sessionId,
        consentVersion: "together-v1",
        consentAccepted: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      repo.visibility(a, s.sessionId, key(), {
        audience: "nearby",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await repo.visibility(a, s.sessionId, key(), {
      audience: "friends",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    expect((await repo.discovery(b, { audience: "friends" })).data).toEqual([]);
    await db
      .insert(schema.friendships)
      .values({ userId: a, friendId: b, status: "accepted", initiatedBy: a });
    expect(
      (await repo.discovery(b, { audience: "friends", limit: 1 })).data[0]
        .sessionId,
    ).toBe(s.sessionId);
    const page = await repo.discovery(b, { audience: "friends", limit: 1 });
    expect(
      (
        await repo.discovery(b, {
          audience: "friends",
          cursor: page.nextCursor!,
        })
      ).data,
    ).toEqual([]);
    const req = await repo.requestJoin(b, key(), {
      sessionId: s.sessionId,
      consentVersion: "together-v1",
      consentAccepted: true,
    });
    await repo.decide(a, s.sessionId, req.requestId, key(), {
      decision: "reject",
      expectedRevision: (await repo.snapshot(a, s.sessionId)).revision,
    });
    expect((await repo.listRequests(a, s.sessionId)).data).toEqual([]);
    await withActors([a, b], (tx) => revokePair(tx, a, b, "friend_removed"));
    await repo.visibility(a, s.sessionId, key(), {
      audience: "nearby",
      placeId: "geoapify:place",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    expect(
      (
        await repo.discovery(b, {
          audience: "nearby",
          placeId: "geoapify:place",
        })
      ).data,
    ).toHaveLength(1);
  });
  it("records actual independent history and PRs atomically then recovers failed durable volume effects", async () => {
    const s = await pair();
    const pid = s.plan.exercises[0].planExerciseId;
    await run(a, s.sessionId, cmd(a, pid));
    await run(
      b,
      s.sessionId,
      cmd(b, pid, 0, { type: "upsertSet", planExerciseId: pid, set: set(60) }),
    );
    await repo.finish(a, s.sessionId, key(), { expectedOwnRevision: 1 });
    await repo.finish(b, s.sessionId, key(), { expectedOwnRevision: 1 });
    await pg.exec(
      "ALTER TABLE weekly_volume_per_user RENAME TO weekly_volume_unavailable",
    );
    await expect(repo.processJob(s.sessionId, a)).rejects.toThrow();
    expect((await repo.snapshot(a, s.sessionId)).completion.status).toBe(
      "saved",
    );
    expect(
      (await db.select().from(schema.togetherJobs)).find((j) => j.userId === a)
        ?.effectsDone,
    ).toBe(false);
    await pg.exec(
      "ALTER TABLE weekly_volume_unavailable RENAME TO weekly_volume_per_user",
    );
    await Promise.all([
      repo.processJob(s.sessionId, a),
      repo.processJob(s.sessionId, b),
    ]);
    await repo.processJob(s.sessionId, a);
    expect(await db.select().from(schema.workoutSessions)).toHaveLength(2);
    expect(
      (await db.select().from(schema.exerciseSets))
        .map((s) => Number(s.weightKg))
        .sort(),
    ).toEqual([40, 60]);
    expect(await db.select().from(schema.personalRecords)).toHaveLength(4);
    expect(
      (await db.select().from(schema.togetherJobs)).every((j) => j.effectsDone),
    ).toBe(true);
    expect(
      (await repo.finish(a, s.sessionId, key(), { expectedOwnRevision: 1 }))
        .status,
    ).toBe("saved");
  });
  it("recording crash before mapping rolls back history and PRs while durable job remains retryable", async () => {
    const s = await create();
    await run(a, s.sessionId, cmd(a, s.plan.exercises[0].planExerciseId));
    await repo.finish(a, s.sessionId, key(), { expectedOwnRevision: 1 });
    await pg.exec(
      "CREATE FUNCTION fail_mapping() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='saved' THEN RAISE EXCEPTION 'mapping crash'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_mapping BEFORE UPDATE ON together_participants FOR EACH ROW EXECUTE FUNCTION fail_mapping()",
    );
    await expect(repo.processJob(s.sessionId, a)).rejects.toThrow();
    expect(await db.select().from(schema.workoutSessions)).toEqual([]);
    expect(await db.select().from(schema.personalRecords)).toEqual([]);
    expect((await repo.snapshot(a, s.sessionId)).completion.status).toBe(
      "finalizing",
    );
    await pg.exec(
      "DROP TRIGGER fail_mapping ON together_participants; DROP FUNCTION fail_mapping()",
    );
    await repo.processJob(s.sessionId, a);
    expect(await db.select().from(schema.workoutSessions)).toHaveLength(1);
  });
  it("deleted host preserves surviving athlete recovery and prevents collaboration", async () => {
    const s = await pair();
    await db.delete(schema.profiles).where(eq(schema.profiles.id, a));
    const snapshot = await repo.snapshot(b, s.sessionId);
    expect(snapshot.hostId).toBeNull();
    expect(snapshot.participants).toHaveLength(1);
    await run(b, s.sessionId, cmd(b, s.plan.exercises[0].planExerciseId));
    expect(
      await repo.finish(b, s.sessionId, key(), { expectedOwnRevision: 1 }),
    ).toMatchObject({ status: "pending" });
  });
});

// JWT signature validation belongs to supabaseAuth's dedicated tests. Here only that
// external identity boundary is substituted; routes use real repository/database policy.
vi.mock("@persistence/api-utils/auth/supabaseAuth", async (original) => ({
  ...(await original<object>()),
  getAuthUser: async (authorization?: string) =>
    authorization?.startsWith("Bearer ")
      ? { sub: authorization.slice(7) }
      : null,
}));
async function http(
  path: string,
  actor: string | null,
  method = "GET",
  body?: unknown,
  idem: string = key(),
) {
  const { togetherRoutes } = await import("../togetherRoutes");
  return togetherRoutes.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(actor ? { authorization: `Bearer ${actor}` } : {}),
        "content-type": "application/json",
        "idempotency-key": idem,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
describe("Together authenticated HTTP contracts", () => {
  it("rejects unauthenticated, malformed consent and invalid identifiers without writes", async () => {
    expect((await http("/together/sessions/active", null)).status).toBe(401);
    expect((await http("/together/sessions/not-a-uuid", a)).status).toBe(400);
    expect(
      (
        await http("/together/join-requests", a, "POST", {
          sessionId: key(),
          consentVersion: "together-v1",
          consentAccepted: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await http(
          "/together/sessions",
          a,
          "POST",
          {
            clientDraftId: key(),
            plan: plan(),
            ownExecution: { exercises: [] },
          },
          "bad",
        )
      ).status,
    ).toBe(400);
    expect(await db.select().from(schema.togetherSessions)).toEqual([]);
  });
  it("executes the full route lifecycle using JWT actors, server-owned access and command validation", async () => {
    const p = plan();
    const created = await http("/together/sessions", a, "POST", {
      clientDraftId: key(),
      plan: p,
      ownExecution: { exercises: [] },
    });
    expect(created.status).toBe(200);
    const { data: s } = (await created.json()) as {
      data: { sessionId: string };
    };
    const base = `/together/sessions/${s.sessionId}`;
    expect((await http(base, b)).status).toBe(404);
    expect((await http("/together/sessions/active", a)).status).toBe(200);
    const inviteRes = await http(`${base}/invites`, a, "POST", {
      expiresInMinutes: 15,
    });
    expect(inviteRes.status).toBe(200);
    const { data: invite } = (await inviteRes.json()) as {
      data: { tokenId: string };
    };
    expect(
      (await http(`${base}/invites/${invite.tokenId}`, a, "DELETE")).status,
    ).toBe(200);
    const { data: i } = (await (
      await http(`${base}/invites`, a, "POST", { expiresInMinutes: 15 })
    ).json()) as { data: { token: string } };
    const join = await http("/together/join-requests", b, "POST", {
      inviteToken: i.token,
      consentVersion: "together-v1",
      consentAccepted: true,
    });
    expect(join.status).toBe(200);
    const { data: r } = (await join.json()) as { data: { requestId: string } };
    expect((await http(`${base}/join-requests?limit=1`, a)).status).toBe(200);
    expect(
      (
        await http(`${base}/join-requests/${r.requestId}/decision`, a, "POST", {
          decision: "approve",
          expectedRevision: (await repo.snapshot(a, s.sessionId)).revision,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await http(`${base}/delegation`, b, "PUT", {
          allowPartnerLogging: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await http(
          `${base}/commands`,
          a,
          "POST",
          cmd(a, p.exercises[0].planExerciseId),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await http(
          `${base}/commands`,
          a,
          "POST",
          cmd(a, p.exercises[0].planExerciseId, 1, {
            type: "upsertSet",
            planExerciseId: p.exercises[0].planExerciseId,
            set: { ...set(), weightKg: -1 },
          }),
        )
      ).status,
    ).toBe(400);
    expect((await http(`${base}/events?afterRevision=0`, b)).status).toBe(200);
    expect((await http(`${base}/realtime-ticket`, b, "POST", {})).status).toBe(
      200,
    );
    expect(
      (
        await http(`${base}/visibility`, a, "PUT", {
          audience: "private",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        })
      ).status,
    ).toBe(200);
    expect((await http("/together/discovery?audience=friends", c)).status).toBe(
      200,
    );
    expect(
      (await http(`${base}/finish`, a, "POST", { expectedOwnRevision: 1 }))
        .status,
    ).toBe(200);
    expect(
      (await http(`${base}/leave`, b, "POST", { expectedOwnRevision: 0 }))
        .status,
    ).toBe(200);
  });
  it("surfaces typed forbidden/version/rate errors and Retry-After", async () => {
    const s = await pair();
    const base = `/together/sessions/${s.sessionId}`;
    const forbidden = await http(`${base}/invites`, b, "POST", {
      expiresInMinutes: 15,
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
    const conflict = await http(
      `${base}/commands`,
      a,
      "POST",
      cmd(a, s.plan.exercises[0].planExerciseId, 9),
    );
    expect(conflict.status).toBe(409);
    await db
      .insert(schema.togetherRateLimits)
      .values({
        actorId: a,
        bucket: "together-http",
        windowStart: new Date(),
        attempts: 120,
      })
      .onConflictDoUpdate({
        target: [
          schema.togetherRateLimits.actorId,
          schema.togetherRateLimits.bucket,
        ],
        set: { attempts: 120 },
      });
    const limited = await http(base, a);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });
});

describe("remaining recovery and migration boundaries", () => {
  it("preserves substituted exercise attribution, omits unperformed plan exercises and materializes real effects", async () => {
    const p = plan();
    p.exercises.push({
      planExerciseId: key(),
      exerciseId: exercise,
      order: 1,
      targetSets: 2,
    });
    const s = await create(
      {
        exercises: [
          {
            planExerciseId: p.exercises[0].planExerciseId,
            substituteExerciseId: otherExercise,
            skipped: false,
            sets: [set(45)],
          },
        ],
      },
      p,
    );
    await repo.finish(a, s.sessionId, key(), { expectedOwnRevision: 0 });
    await repo.processJob(s.sessionId, a);
    const saved = await db.select().from(schema.sessionExercises);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      exerciseId: otherExercise,
      originalExerciseId: exercise,
    });
    expect(await db.select().from(schema.weeklyVolumePerUser)).toHaveLength(1);
    expect(await db.select().from(schema.userStreaks)).toHaveLength(1);
  });
  it("approves friends discovery without token and retries current snapshots without retaining partner payload", async () => {
    const body = {
      clientDraftId: key(),
      plan: plan(),
      ownExecution: { exercises: [] },
    };
    const ck = key();
    const s = await repo.create(a, ck, body);
    await db
      .insert(schema.friendships)
      .values({ userId: a, friendId: b, status: "accepted", initiatedBy: a });
    await repo.visibility(a, s.sessionId, key(), {
      audience: "friends",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    const req = await repo.requestJoin(b, key(), {
      sessionId: s.sessionId,
      consentVersion: "together-v1",
      consentAccepted: true,
    });
    const k = key(),
      decision = {
        decision: "approve" as const,
        expectedRevision: (await repo.snapshot(a, s.sessionId)).revision,
      };
    await repo.decide(a, s.sessionId, req.requestId, k, decision);
    expect(
      (await repo.decide(a, s.sessionId, req.requestId, k, decision))
        .participants,
    ).toHaveLength(2);
    await withActors([a, b], (tx) => revokePair(tx, a, b, "block"));
    expect((await repo.create(a, ck, body)).snapshot.participants).toHaveLength(
      1,
    );
    await expect(
      repo.decide(a, s.sessionId, req.requestId, k, decision),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("caps connected devices, accepts disconnect reconnect and rejects expired tickets and replay cursors", async () => {
    const s = await create();
    for (let i = 0; i < 5; i++) {
      const ticket = await repo.ticket(a, s.sessionId, key());
      await repo.consumeTicket(ticket.ticket, `connection-${i}`);
    }
    const ticket = await repo.ticket(a, s.sessionId, key());
    await expect(
      repo.consumeTicket(ticket.ticket, "six"),
    ).rejects.toMatchObject({ code: "CONNECTION_LIMIT" });
    await repo.disconnect("connection-0");
    await repo.consumeTicket(ticket.ticket, "six");
    const expired = await repo.ticket(a, s.sessionId, key());
    await db.update(schema.togetherTickets).set({ expiresAt: new Date(0) });
    await expect(
      repo.consumeTicket(expired.ticket, "seven"),
    ).rejects.toMatchObject({ status: 403 });
    await run(a, s.sessionId, cmd(a, s.plan.exercises[0].planExerciseId));
    await db.update(schema.togetherEvents).set({ createdAt: new Date(0) });
    await expect(repo.events(a, s.sessionId, 0)).rejects.toMatchObject({
      code: "CURSOR_EXPIRED",
    });
  });
  it("protects all new tables with RLS, no direct app-role grants, and reversible migration preserves legacy tables", async () => {
    const flags = await pg.query<{ name: string; enabled: boolean }>(
      "SELECT c.relname AS name,c.relrowsecurity AS enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (c.relname LIKE 'together_%' OR c.relname LIKE 'social_%')",
    );
    expect(flags.rows).toHaveLength(18);
    expect(flags.rows.every((r) => r.enabled)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      const grants = await pg.query<{ ok: boolean }>(
        "SELECT has_table_privilege($1,'together_sessions','SELECT') AS ok",
        [role],
      );
      expect(grants.rows[0].ok).toBe(false);
    }
    await pg.exec(
      readFileSync(
        new URL(
          "../../../../../../supabase/rollbacks/20260921211637_together_backend.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect((await pg.query("select * from profiles")).rows).toHaveLength(3);
    expect(
      (
        await pg.query(
          "select relname from pg_class where relname='together_sessions'",
        )
      ).rows,
    ).toHaveLength(0);
    await pg.exec(migration);
  });
});

describe("observed revocation cannot be undone by retries or renewed payment", () => {
  it("commits paid-loss revocation even when the attempted partner mutation fails", async () => {
    const s = await pair();
    const grant = await repo.delegation(b, s.sessionId, key(), {
      allowPartnerLogging: true,
    });
    await db
      .delete(schema.userSubscriptions)
      .where(eq(schema.userSubscriptions.userId, b));
    await expect(
      run(a, s.sessionId, {
        ...cmd(b, s.plan.exercises[0].planExerciseId),
        delegationGeneration: grant.generation,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await db.insert(schema.userSubscriptions).values({
      userId: b,
      tierName: "premium",
      paymentStatus: "active" as never,
      startsAt: new Date(0),
    });
    expect((await repo.snapshot(a, s.sessionId)).participants).toHaveLength(1);
    await expect(repo.ticket(b, s.sessionId, key())).rejects.toMatchObject({
      status: 403,
    });
    await run(b, s.sessionId, cmd(b, s.plan.exercises[0].planExerciseId));
  });
  it("observes either-direction database blocks without relying on an in-memory policy", async () => {
    const s = await pair();
    await db.insert(schema.socialBlocks).values({ actorId: b, subjectId: a });
    expect((await repo.snapshot(a, s.sessionId)).participants).toHaveLength(1);
    await db.delete(schema.socialBlocks);
    expect((await repo.snapshot(b, s.sessionId)).participants).toHaveLength(1);
  });
});

describe("scoped friend invitation revocation", () => {
  it("removing B preserves C invitation access and never restores old B grants after refriending", async () => {
    const s = await create();
    await db.insert(schema.friendships).values([
      { userId: a, friendId: b, status: "accepted", initiatedBy: a },
      { userId: a, friendId: c, status: "accepted", initiatedBy: a },
    ]);
    await repo.visibility(a, s.sessionId, key(), {
      audience: "friends",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    const invite = await repo.invite(a, s.sessionId, key(), {
      expiresInMinutes: 15,
    });
    const bReq = await repo.requestJoin(b, key(), {
      inviteToken: invite.token,
      consentVersion: "together-v1",
      consentAccepted: true,
    });
    await withActors([a, b], (tx) => revokePair(tx, a, b, "friend_removed"));
    await expect(
      repo.requestJoin(b, key(), {
        inviteToken: invite.token,
        consentVersion: "together-v1",
        consentAccepted: true,
      }),
    ).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
    const cReq = await repo.requestJoin(c, key(), {
      inviteToken: invite.token,
      consentVersion: "together-v1",
      consentAccepted: true,
    });
    expect(cReq.status).toBe("pending");
    expect(
      (await db.select().from(schema.togetherJoinRequests)).find(
        (r) => r.id === bReq.requestId,
      )?.status,
    ).toBe("rejected");
    expect(
      (await repo.listRequests(a, s.sessionId, { limit: 1 })).data[0].userId,
    ).toBe(c);
  });
});

describe("exercise retention and recording precision", () => {
  it("rejects third-party private exercises before promotion and rejects unauthorised guests on admission", async () => {
    const privateId = key();
    await db.insert(schema.exercises).values({
      id: privateId,
      name: "Private",
      createdBy: c,
      isPublic: false,
    });
    const p = plan();
    p.exercises[0].exerciseId = privateId;
    await expect(create({ exercises: [] }, p)).rejects.toMatchObject({
      status: 400,
    });
    await db
      .update(schema.exercises)
      .set({ createdBy: a })
      .where(eq(schema.exercises.id, privateId));
    const s = await create({ exercises: [] }, p);
    const invite = await repo.invite(a, s.sessionId, key(), {
      expiresInMinutes: 15,
    });
    const req = await repo.requestJoin(b, key(), {
      inviteToken: invite.token,
      consentVersion: "together-v1",
      consentAccepted: true,
    });
    await expect(
      repo.decide(a, s.sessionId, req.requestId, key(), {
        decision: "approve",
        expectedRevision: (await repo.snapshot(a, s.sessionId)).revision,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("recovers a deleted personal exercise from its frozen definition and records bounded max set values", async () => {
    const privateId = key();
    await db.insert(schema.exercises).values({
      id: privateId,
      name: "My custom lift",
      createdBy: a,
      isPublic: false,
    });
    const p = plan();
    p.exercises[0].exerciseId = privateId;
    const s = await create({ exercises: [] }, p);
    await run(
      a,
      s.sessionId,
      cmd(a, p.exercises[0].planExerciseId, 0, {
        type: "upsertSet",
        planExerciseId: p.exercises[0].planExerciseId,
        set: { ...set(9999.99), reps: 10000 },
      }),
    );
    await db.delete(schema.exercises).where(eq(schema.exercises.id, privateId));
    await repo.finish(a, s.sessionId, key(), { expectedOwnRevision: 1 });
    await repo.processJob(s.sessionId, a);
    const [record] = await db.select().from(schema.sessionExercises);
    expect(record.exerciseId).not.toBe(privateId);
    const [copy] = await db
      .select()
      .from(schema.exercises)
      .where(eq(schema.exercises.id, record.exerciseId));
    expect(copy).toMatchObject({
      createdBy: a,
      isPublic: false,
      name: "My custom lift",
      clientRequestId: `together-recovery:${privateId}`,
    });
    expect(
      (await db.select().from(schema.personalRecords)).map((r) =>
        Number(r.value),
      ),
    ).toContain(99999900);
    const { exerciseDefinitions } = (
      await db.select().from(schema.togetherParticipants)
    )[0];
    expect(exerciseDefinitions[privateId].recordingExerciseId).toBe(copy.id);
  });
  it("clones authorized foreign custom sources before recording so later creator purge cannot erase another athlete sets", async () => {
    const privateId = key();
    await db.insert(schema.exercises).values({
      id: privateId,
      name: "Coach lift",
      createdBy: c,
      isPublic: false,
    });
    const [workout] = await db
      .insert(schema.workouts)
      .values({ name: "Assigned", createdBy: c })
      .returning();
    await db
      .insert(schema.workoutExercises)
      .values({ workoutId: workout.id, exerciseId: privateId, sortOrder: 0 });
    await db.insert(schema.workoutAssignments).values({
      workoutId: workout.id,
      clientId: a,
      trainerId: c,
      assignedDate: "2026-09-21",
    });
    const p = plan();
    p.exercises[0].exerciseId = privateId;
    const s = await create({ exercises: [] }, p);
    await run(a, s.sessionId, cmd(a, p.exercises[0].planExerciseId));
    await repo.finish(a, s.sessionId, key(), { expectedOwnRevision: 1 });
    await repo.processJob(s.sessionId, a);
    const [saved] = await db.select().from(schema.sessionExercises);
    expect(saved.exerciseId).not.toBe(privateId);
    await db.delete(schema.profiles).where(eq(schema.profiles.id, c));
    expect(await db.select().from(schema.exerciseSets)).toHaveLength(1);
    expect(await db.select().from(schema.sessionExercises)).toHaveLength(1);
    expect(
      (await db.select().from(schema.exercises)).some(
        (e) => e.id === saved.exerciseId && e.createdBy === a,
      ),
    ).toBe(true);
  });
  it("canonicalizes self command target in durable replay and emits a durable join-request wakeup", async () => {
    const s = await create();
    const command = {
      ...cmd(a, s.plan.exercises[0].planExerciseId),
      target: { kind: "execution" as const },
    };
    await run(a, s.sessionId, command);
    const replay = await repo.events(a, s.sessionId, 0);
    expect(replay.data[0].event).toMatchObject({
      actorId: a,
      target: { kind: "execution", athleteId: a },
    });
    const invite = await repo.invite(a, s.sessionId, key(), {
      expiresInMinutes: 15,
    });
    const request = await repo.requestJoin(b, key(), {
      inviteToken: invite.token,
      consentVersion: "together-v1",
      consentAccepted: true,
    });
    expect((await repo.listPendingEvents()).at(-1)?.event).toEqual({
      type: "join_requested",
    });
    await withActors([a, b], (tx) => revokePair(tx, a, b, "block"));
    await expect(
      repo.decide(a, s.sessionId, request.requestId, key(), {
        decision: "approve",
        expectedRevision: (await repo.snapshot(a, s.sessionId)).revision,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      repo.requestJoin(b, key(), {
        inviteToken: invite.token,
        consentVersion: "together-v1",
        consentAccepted: true,
      }),
    ).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
    expect(
      (
        await repo.requestJoin(c, key(), {
          inviteToken: invite.token,
          consentVersion: "together-v1",
          consentAccepted: true,
        })
      ).status,
    ).toBe("pending");
  });
});

describe("serialized first-write identity races", () => {
  it("serializes first set against underlying shared plan replacement", async () => {
    const s = await pair();
    const pid = s.plan.exercises[0].planExerciseId;
    const replacement = {
      ...s.plan,
      exercises: [{ ...s.plan.exercises[0], exerciseId: otherExercise }],
    };
    const outcomes = await Promise.allSettled([
      run(b, s.sessionId, cmd(b, pid)),
      run(a, s.sessionId, {
        commandId: key(),
        target: { kind: "plan" },
        expectedVersion: 1,
        operation: { type: "replacePlan", plan: replacement },
      }),
    ]);
    expect(outcomes[0].status).toBe("fulfilled");
    const snapshot = await repo.snapshot(a, s.sessionId);
    expect(
      snapshot.participants.find((p) => p.userId === b)?.execution.exercises[0]
        .everAcknowledged,
    ).toBe(true);
    if (outcomes[1].status === "rejected")
      expect(snapshot.plan.exercises[0].exerciseId).toBe(exercise);
    else expect(snapshot.plan.exercises[0].exerciseId).toBe(otherExercise);
    await expect(
      run(a, s.sessionId, {
        commandId: key(),
        target: { kind: "plan" },
        expectedVersion: snapshot.planVersion,
        operation: { type: "replacePlan", plan: { ...s.plan, exercises: [] } },
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
  it("first-set and substitution compete on the same personal revision and preserve committed identity", async () => {
    const s = await create();
    const pid = s.plan.exercises[0].planExerciseId;
    const outcomes = await Promise.allSettled([
      run(a, s.sessionId, cmd(a, pid)),
      run(
        a,
        s.sessionId,
        cmd(a, pid, 0, {
          type: "substitute",
          planExerciseId: pid,
          exerciseId: otherExercise,
        }),
      ),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "VERSION_CONFLICT" },
    });
    const snapshot = await repo.snapshot(a, s.sessionId);
    expect(snapshot.participants[0].ownRevision).toBe(1);
  });
});
