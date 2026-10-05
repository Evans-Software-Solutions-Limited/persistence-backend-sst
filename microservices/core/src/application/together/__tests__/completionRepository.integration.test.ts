import { PersonalRecordsRepository } from "../../repositories/personalRecordsRepository";
import { SessionRepository } from "../../repositories/sessionRepository";
import { TogetherOfflineRepository } from "../offlineRepository";
import { processTogetherJob } from "../recording";
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
  TogetherCompletionRepository,
  processReviewedEffects,
  pendingReviewedEffects,
} from "../completionRepository";
import * as recovered from "../recoveredRecording";
import { requestHash } from "../shared";
const executedQueries: string[] = [];
let pg: PGlite;
let db: ReturnType<typeof drizzle>;
const a = randomUUID(),
  b = randomUUID(),
  exercise = randomUUID(),
  otherExercise = randomUUID();
const key = () => randomUUID();
const repo = new TogetherCompletionRepository();
const recoveryRepo = new TogetherOfflineRepository();
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
const offlineMigration = readFileSync(
  new URL(
    "../../../../../../supabase/migrations/20260930160418_together_offline_recovery.sql",
    import.meta.url,
  ),
  "utf8",
);
const reviewMigration = readFileSync(
  new URL(
    "../../../../../../supabase/migrations/20261001120000_together_reviewed_results.sql",
    import.meta.url,
  ),
  "utf8",
);
const reviewRollback = readFileSync(
  new URL(
    "../../../../../../supabase/rollbacks/20261001120000_together_reviewed_results.sql",
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
  await pg.exec(
    readFileSync(
      new URL(
        "../../../../../../supabase/migrations/20261001133310_together_previous_consent.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pg.exec(migration);
  await pg.exec(
    readFileSync(
      new URL(
        "../../../../../../supabase/migrations/20261001133310_together_previous_consent.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pg.exec(offlineMigration);
  await pg.exec(offlineMigration);
  await pg.exec(reviewMigration);
  await pg.exec(reviewMigration);
  await pg.exec(reviewRollback);
  await pg.exec(reviewRollback);
  await pg.exec(reviewMigration);
  await pg.exec(
    readFileSync(
      new URL(
        "../../../../../../supabase/migrations/20261005120000_together_numbers_consent.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  db = drizzle(pg, {
    schema,
    logger: {
      logQuery(query) {
        executedQueries.push(query);
      },
    },
  });
  holder.db = db;
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await pg.exec(
    "TRUNCATE profiles,exercises,subscription_tiers,user_subscriptions,friendships,workouts,workout_sessions,session_exercises,exercise_sets,personal_records,user_streaks,user_achievements,achievements,weekly_volume_per_user,volume_by_muscle_per_user CASCADE",
  );
  await db.insert(schema.profiles).values([
    { id: a, fullName: "A" },
    { id: b, fullName: "B" },
  ]);
  await db.insert(schema.exercises).values([
    { id: exercise, name: "Squat" },
    { id: otherExercise, name: "Press", isPublic: false, createdBy: b },
  ]);
  vi.stubEnv("TOGETHER_ENABLED", "true");
});
afterAll(async () => {
  await pg.close();
  vi.unstubAllEnvs();
});
const plan = () => ({
  name: "Reviewed session",
  exercises: [
    { planExerciseId: key(), exerciseId: exercise, order: 0, targetSets: 3 },
  ],
});
function execution(
  p: schema.TogetherPlan,
  weightKg = 40,
): schema.TogetherExecution {
  return {
    exercises: [
      {
        planExerciseId: p.exercises[0].planExerciseId,
        skipped: false,
        sets: [{ setId: key(), reps: 8, weightKg, completed: true }],
      },
    ],
  };
}
async function offline(empty = false) {
  const p = plan(),
    executionId = key(),
    sessionId = key(),
    startedAt = new Date(Date.now() - 7200000),
    completedAt = new Date(Date.now() - 3600000).toISOString();
  const e = empty ? { exercises: [] } : execution(p);
  await db.insert(schema.togetherOfflineExecutions).values({
    userId: a,
    executionId,
    sessionId,
    plan: p,
    planHash: requestHash(p),
    execution: e,
    revision: 1,
    startedAt,
  });
  return { p, e, executionId, sessionId, completedAt };
}
async function cloud(status = "finished_empty") {
  const p = plan(),
    sessionId = key();
  await db.insert(schema.togetherSessions).values({
    id: sessionId,
    hostId: b,
    clientDraftId: key(),
    promotionHash: "test",
    plan: p,
    state: "closed",
    collaborationRevoked: true,
    expiresAt: new Date(Date.now() + 100000),
    createdAt: new Date(Date.now() - 7200000),
  });
  await db.insert(schema.togetherParticipants).values({
    sessionId,
    userId: a,
    status,
    execution: { exercises: [] },
    frozenPlan: p,
    consentVersion: "together-v1",
  });
  return { p, sessionId };
}
describe("explicit owner-reviewed Together results", () => {
  it("records only on explicit acceptance and keeps one stable history across receipts and later reduced work", async () => {
    const f = await offline();
    expect(await db.select().from(schema.workoutSessions)).toHaveLength(0);
    const k = key(),
      body = { expectedRevision: 1, completedAt: f.completedAt };
    const first = await repo.completeOffline(a, f.executionId, k, body);
    expect(first).toMatchObject({
      status: "saved",
      reviewedRevision: 1,
      effectsPending: true,
      sharingActive: false,
    });
    expect(first.historyId).toBeTruthy();
    expect(await recoveryRepo.getRecovery(a, f.executionId)).toMatchObject({
      status: "saved",
      historySaved: true,
      historyId: first.historyId,
      effectsPending: true,
    });
    expect(await repo.completeOffline(a, f.executionId, k, body)).toEqual(
      first,
    );
    expect(await repo.completeOffline(a, f.executionId, key(), body)).toEqual(
      first,
    );
    expect(
      (await db.select().from(schema.togetherReviewedResults))[0]
        .effectsVersion,
    ).toBe(1);
    const reduced = execution(f.p, 10);
    await db
      .update(schema.togetherOfflineExecutions)
      .set({ execution: reduced, revision: 2 });
    expect(await recoveryRepo.getRecovery(a, f.executionId)).toMatchObject({
      status: "stored_for_review",
      historySaved: false,
      historyId: first.historyId,
    });
    const amended = await repo.completeOffline(a, f.executionId, key(), {
      ...body,
      expectedRevision: 2,
      completedAt: new Date().toISOString(),
    });
    expect(amended.historyId).toBe(first.historyId);
    expect(amended.reviewedRevision).toBe(2);
    expect(await db.select().from(schema.workoutSessions)).toHaveLength(1);
    expect(await db.select().from(schema.exerciseSets)).toHaveLength(1);
    expect(
      Number((await db.select().from(schema.exerciseSets))[0].weightKg),
    ).toBe(10);
    const result = (await db.select().from(schema.togetherReviewedResults))[0];
    expect(result.effectsVersion).toBe(2);
    expect(result.completedAt.toISOString()).toBe(f.completedAt);
    expect(
      (
        await db.select().from(schema.workoutSessions)
      )[0].completedAt?.toISOString(),
    ).toBe(f.completedAt);
    expect(result.clientRecordId).toBe(f.executionId);
  });
  it("empty accepted candidate creates no history but later nonempty review gets one stable result", async () => {
    const f = await offline(true),
      body = { expectedRevision: 1, completedAt: f.completedAt };
    expect(
      await repo.completeOffline(a, f.executionId, key(), body),
    ).toMatchObject({ status: "finished_empty", historyId: null });
    expect(await db.select().from(schema.workoutSessions)).toHaveLength(0);
    const empty = (await db.select().from(schema.togetherReviewedResults))[0];
    expect(empty.clientRecordId).toBe(f.executionId);
    expect(await recoveryRepo.getRecovery(a, f.executionId)).toMatchObject({
      status: "finished_empty",
      historySaved: false,
      historyId: null,
    });
    await db
      .update(schema.togetherOfflineExecutions)
      .set({ revision: 2, execution: execution(f.p) });
    const filled = await repo.completeOffline(a, f.executionId, key(), {
      ...body,
      expectedRevision: 2,
    });
    expect(filled.historyId).toBeTruthy();
    await db
      .update(schema.togetherOfflineExecutions)
      .set({ revision: 3, execution: { exercises: [] } });
    const cleared = await repo.completeOffline(a, f.executionId, key(), {
      ...body,
      expectedRevision: 3,
    });
    expect(cleared.historyId).toBe(filled.historyId);
    expect(cleared.status).toBe("finished_empty");
    expect(await db.select().from(schema.workoutSessions)).toHaveLength(1);
    expect(await db.select().from(schema.exerciseSets)).toHaveLength(0);
  });
  it("enforces owner, active account, current revision and immutable idempotency body without requiring paid access", async () => {
    const f = await offline(),
      body = { expectedRevision: 1, completedAt: f.completedAt },
      k = key();
    await expect(
      repo.completeOffline(b, f.executionId, key(), body),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      repo.completeOffline(a, f.executionId, key(), {
        ...body,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    // No subscription exists: personal recovery still completes.
    await repo.completeOffline(a, f.executionId, k, body);
    await expect(
      repo.completeOffline(a, f.executionId, k, {
        ...body,
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await db
      .update(schema.profiles)
      .set({ deletedAt: new Date() })
      .where(eq(schema.profiles.id, a));
    await expect(
      repo.completeOffline(a, f.executionId, k, body),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.stubEnv("TOGETHER_ENABLED", "false");
    await expect(
      repo.completeOffline(a, f.executionId, k, body),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rejects unavailable exercises and invalid times while preserving the recoverable candidate", async () => {
    const f = await offline();
    await expect(
      repo.completeOffline(a, f.executionId, key(), {
        expectedRevision: 1,
        completedAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    await expect(
      repo.completeOffline(a, f.executionId, key(), {
        expectedRevision: 1,
        completedAt: "invalid",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    await expect(
      repo.completeOffline(a, f.executionId, key(), {
        expectedRevision: 1,
        completedAt: new Date(0).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    await db.update(schema.togetherOfflineExecutions).set({
      plan: {
        ...f.p,
        exercises: [{ ...f.p.exercises[0], exerciseId: otherExercise }],
      },
    });
    await expect(
      repo.completeOffline(a, f.executionId, key(), {
        expectedRevision: 1,
        completedAt: f.completedAt,
      }),
    ).rejects.toMatchObject({ code: "EXERCISE_UNAVAILABLE" });
    expect(
      await db.select().from(schema.togetherOfflineExecutions),
    ).toHaveLength(1);
    expect(await db.select().from(schema.workoutSessions)).toHaveLength(0);
    expect(await db.select().from(schema.togetherReviewedResults)).toHaveLength(
      0,
    );
  });
  it("reviews a closed cloud empty result, then amends the same saved history with fresh personal revision", async () => {
    const f = await cloud(),
      e = execution(f.p),
      k = key();
    await expect(
      repo.reviewCloud(b, f.sessionId, key(), {
        expectedOwnRevision: 0,
        execution: e,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const body = { expectedOwnRevision: 0, execution: e };
    const first = await repo.reviewCloud(a, f.sessionId, k, body);
    expect(first).toMatchObject({ status: "saved", reviewedRevision: 1 });
    expect(await repo.reviewCloud(a, f.sessionId, k, body)).toEqual(first);
    await expect(
      repo.reviewCloud(a, f.sessionId, key(), body),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const amended = await repo.reviewCloud(a, f.sessionId, key(), {
      expectedOwnRevision: 1,
      execution: execution(f.p, 15),
    });
    expect(amended.historyId).toBe(first.historyId);
    expect(amended.reviewedRevision).toBe(2);
    const participant = (
      await db.select().from(schema.togetherParticipants)
    )[0];
    expect(participant.ownRevision).toBe(2);
    expect(participant.historyId).toBe(first.historyId);
    expect(await db.select().from(schema.workoutSessions)).toHaveLength(1);
  });
  it("amends an existing legacy job result and a later legacy worker cannot restore its old sets or effects", async () => {
    const f = await cloud("finalizing"),
      clientRecordId = key();
    await db.update(schema.togetherParticipants).set({
      execution: execution(f.p, 80),
      exerciseDefinitions: {
        [exercise]: {
          name: "Squat",
          category: "strength",
          primaryMuscles: [],
          createdBy: null,
        },
      },
    });
    await db.insert(schema.togetherJobs).values({
      sessionId: f.sessionId,
      userId: a,
      clientRecordId,
      completedAt: new Date(Date.now() - 3600000),
    });
    await processTogetherJob(f.sessionId, a);
    const original = (await db.select().from(schema.togetherParticipants))[0]
      .historyId;
    const amended = await repo.reviewCloud(a, f.sessionId, key(), {
      expectedOwnRevision: 0,
      execution: execution(f.p, 10),
    });
    expect(amended.historyId).toBe(original);
    expect(
      (await db.select().from(schema.togetherReviewedResults))[0]
        .clientRecordId,
    ).toBe(clientRecordId);
    await processReviewedEffects(a, f.sessionId);
    const records = await db.select().from(schema.personalRecords),
      sets = await db.select().from(schema.exerciseSets);
    await processTogetherJob(f.sessionId, a);
    expect(await db.select().from(schema.exerciseSets)).toEqual(sets);
    expect(await db.select().from(schema.personalRecords)).toEqual(records);
    expect(await db.select().from(schema.workoutSessions)).toHaveLength(1);
    expect(Number(sets[0].weightKg)).toBe(10);
  });
  it("refuses cloud review while active/finalizing or sharing remains live", async () => {
    const f = await cloud("active"),
      body = { expectedOwnRevision: 0, execution: execution(f.p) };
    await expect(
      repo.reviewCloud(a, f.sessionId, key(), body),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await db.update(schema.togetherParticipants).set({ status: "finalizing" });
    await expect(
      repo.reviewCloud(a, f.sessionId, key(), body),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await db
      .update(schema.togetherParticipants)
      .set({ status: "finished_empty" });
    await db
      .update(schema.togetherSessions)
      .set({ state: "active", collaborationRevoked: false });
    await expect(
      repo.reviewCloud(a, f.sessionId, key(), body),
    ).rejects.toMatchObject({ code: "SHARING_ACTIVE" });
  });
  it("validates execution references and duplicates before replacing a saved owner's data", async () => {
    const f = await cloud(),
      e = execution(f.p),
      body = { expectedOwnRevision: 0, execution: e };
    const bad = [
      { exercises: [...e.exercises, ...e.exercises] },
      { exercises: [{ ...e.exercises[0], planExerciseId: key() }] },
      {
        exercises: [
          {
            ...e.exercises[0],
            sets: [...e.exercises[0].sets, ...e.exercises[0].sets],
          },
        ],
      },
      {
        exercises: [
          {
            ...e.exercises[0],
            sets: [{ ...e.exercises[0].sets[0], reps: -1 }],
          },
        ],
      },
    ];
    for (const execution of bad)
      await expect(
        repo.reviewCloud(a, f.sessionId, key(), { ...body, execution }),
      ).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    expect(await db.select().from(schema.workoutSessions)).toHaveLength(0);
    expect(
      (await db.select().from(schema.togetherParticipants))[0].ownRevision,
    ).toBe(0);
  });
  it("retains a pending effects watermark on failure and safely retries and acknowledges the latest revision", async () => {
    const f = await offline();
    await repo.completeOffline(a, f.executionId, key(), {
      expectedRevision: 1,
      completedAt: f.completedAt,
    });
    expect(await pendingReviewedEffects()).toHaveLength(1);
    const failure = vi
      .spyOn(recovered, "recomputeRecoveredEffects")
      .mockRejectedValueOnce(new Error("temporary effects failure"));
    await expect(processReviewedEffects(a, f.sessionId)).rejects.toThrow(
      "temporary effects failure",
    );
    failure.mockRestore();
    expect(
      (await db.select().from(schema.togetherReviewedResults))[0]
        .effectsDoneVersion,
    ).toBe(0);
    await processReviewedEffects(a, f.sessionId);
    await processReviewedEffects(a, f.sessionId);
    expect(
      (await db.select().from(schema.togetherReviewedResults))[0]
        .effectsDoneVersion,
    ).toBe(1);
    expect(await pendingReviewedEffects()).toHaveLength(0);
    expect(await recoveryRepo.getRecovery(a, f.executionId)).toMatchObject({
      status: "saved",
      effectsPending: false,
    });
    await expect(processReviewedEffects(b, f.sessionId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("rejects collision with an unrelated solo history instead of adopting or amending it", async () => {
    const f = await offline(),
      historyId = key();
    await db.insert(schema.workoutSessions).values({
      id: historyId,
      userId: a,
      clientSessionId: f.executionId,
      name: "Unrelated solo",
      status: "completed",
      startedAt: new Date(Date.now() - 7200000),
      completedAt: new Date(Date.now() - 3600000),
    });
    await expect(
      repo.completeOffline(a, f.executionId, key(), {
        expectedRevision: 1,
        completedAt: f.completedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(schema.workoutSessions)).toMatchObject([
      { id: historyId, name: "Unrelated solo" },
    ]);
    expect(await db.select().from(schema.togetherReviewedResults)).toHaveLength(
      0,
    );
  });
  it("protects mapped results from generic lifecycle, deletion and every child mutation while permitting metadata", async () => {
    const f = await offline(),
      saved = await repo.completeOffline(a, f.executionId, key(), {
        expectedRevision: 1,
        completedAt: f.completedAt,
      });
    const generic = new SessionRepository(),
      historyId = saved.historyId!;
    for (const change of [
      { status: "cancelled" as const },
      { startedAt: new Date(0) },
      { completedAt: new Date(0) },
      { clientSessionId: key() },
      { totalDurationSeconds: 0 },
      { workoutId: key() },
    ])
      await expect(generic.update(historyId, a, change)).rejects.toMatchObject({
        code: "TOGETHER_REVIEW_REQUIRED",
        status: 409,
      });
    await expect(generic.delete(historyId, a)).rejects.toMatchObject({
      code: "TOGETHER_REVIEW_REQUIRED",
    });
    expect(
      await generic.update(historyId, b, { status: "cancelled" }),
    ).toBeNull();
    expect(await generic.delete(historyId, b)).toBe(false);
    expect(
      await generic.update(historyId, a, {
        name: "My corrected name",
        userNotes: "Owner note",
        sessionRating: 4,
      }),
    ).toMatchObject({
      name: "My corrected name",
      userNotes: "Owner note",
      sessionRating: 4,
    });
    const [exerciseRow] = await db.select().from(schema.sessionExercises),
      [setRow] = await db.select().from(schema.exerciseSets);
    await expect(
      generic.addExercise({
        sessionId: historyId,
        exerciseId: exercise,
        sortOrder: 2,
      }),
    ).rejects.toMatchObject({ code: "TOGETHER_REVIEW_REQUIRED" });
    await expect(
      generic.removeExercise(exerciseRow.id, a),
    ).rejects.toMatchObject({ code: "TOGETHER_REVIEW_REQUIRED" });
    await expect(
      generic.addSet({
        sessionExerciseId: exerciseRow.id,
        setNumber: 2,
        reps: 5,
      }),
    ).rejects.toMatchObject({ code: "TOGETHER_REVIEW_REQUIRED" });
    await expect(
      generic.updateSet(setRow.id, a, { reps: 1 }),
    ).rejects.toMatchObject({ code: "TOGETHER_REVIEW_REQUIRED" });
    await expect(generic.deleteSet(setRow.id, a)).rejects.toMatchObject({
      code: "TOGETHER_REVIEW_REQUIRED",
    });
    expect(await db.select().from(schema.exerciseSets)).toEqual([setRow]);
  });
  it("protects legacy participant mappings before their first reviewed-result mapping exists", async () => {
    const f = await cloud("finalizing");
    await db.update(schema.togetherParticipants).set({
      execution: execution(f.p),
      exerciseDefinitions: {
        [exercise]: {
          name: "Squat",
          category: "strength",
          primaryMuscles: [],
          createdBy: null,
        },
      },
    });
    await db.insert(schema.togetherJobs).values({
      sessionId: f.sessionId,
      userId: a,
      completedAt: new Date(Date.now() - 3600000),
    });
    await processTogetherJob(f.sessionId, a);
    expect(await db.select().from(schema.togetherReviewedResults)).toHaveLength(
      0,
    );
    const historyId = (await db.select().from(schema.togetherParticipants))[0]
      .historyId!;
    await expect(
      new SessionRepository().update(historyId, a, { status: "cancelled" }),
    ).rejects.toMatchObject({ code: "TOGETHER_REVIEW_REQUIRED" });
    await expect(
      new SessionRepository().delete(historyId, a),
    ).rejects.toMatchObject({ code: "TOGETHER_REVIEW_REQUIRED" });
  });
  it("retains generic solo edits and rejects relocating a solo set into a protected result", async () => {
    const generic = new SessionRepository(),
      soloId = key();
    await db
      .insert(schema.workoutSessions)
      .values({ id: soloId, userId: a, name: "Solo" });
    expect(
      await generic.update(soloId, a, {
        status: "completed",
        completedAt: new Date(),
      }),
    ).toMatchObject({ status: "completed" });
    const added = await generic.addExercise({
      sessionId: soloId,
      exerciseId: exercise,
      sortOrder: 0,
    });
    const set = await generic.addSet({
      sessionExerciseId: added.id,
      setNumber: 1,
      reps: 4,
    });
    expect(await generic.updateSet(set.id, a, { reps: 5 })).toMatchObject({
      reps: 5,
    });
    const f = await offline(),
      saved = await repo.completeOffline(a, f.executionId, key(), {
        expectedRevision: 1,
        completedAt: f.completedAt,
      });
    const target = (await db.select().from(schema.sessionExercises)).find(
      (e) => e.sessionId === saved.historyId,
    )!;
    await expect(
      generic.updateSet(set.id, a, { sessionExerciseId: target.id }),
    ).rejects.toMatchObject({ code: "TOGETHER_REVIEW_REQUIRED" });
    expect(await generic.deleteSet(set.id, a)).toBe(true);
    expect(await generic.removeExercise(added.id, a)).toBe(true);
    expect(await generic.delete(soloId, a)).toBe(true);
  });
  it("persists newly authorized reviewed substitution definitions for the private owner snapshot", async () => {
    const f = await cloud();
    await db
      .update(schema.exercises)
      .set({ isPublic: true, createdBy: a })
      .where(eq(schema.exercises.id, otherExercise));
    const own = execution(f.p);
    own.exercises[0].substituteExerciseId = otherExercise;
    await repo.reviewCloud(a, f.sessionId, key(), {
      expectedOwnRevision: 0,
      execution: own,
    });
    expect(
      (await db.select().from(schema.togetherParticipants))[0]
        .exerciseDefinitions[otherExercise],
    ).toMatchObject({ name: "Press" });
  });
  it("takes actor locks before root/set/PR mutations to serialize reviewed effects against generic writes", async () => {
    const generic = new SessionRepository(),
      soloId = key();
    await db
      .insert(schema.workoutSessions)
      .values({ id: soloId, userId: a, name: "Solo" });
    const ex = await generic.addExercise({
      sessionId: soloId,
      exerciseId: exercise,
      sortOrder: 0,
    });
    const ownSet = await generic.addSet({
      sessionExerciseId: ex.id,
      setNumber: 1,
      reps: 4,
    });
    executedQueries.length = 0;
    await generic.deleteSet(ownSet.id, a);
    const actorLock = executedQueries.findIndex(
      (q) => q.includes('"together_actors"') && q.includes("for update"),
    );
    const rootLock = executedQueries.findIndex(
      (q) => q.includes("workout_sessions ws") && q.includes("for update"),
    );
    const deletion = executedQueries.findIndex((q) =>
      q.startsWith('delete from "exercise_sets"'),
    );
    expect(actorLock).toBeGreaterThanOrEqual(0);
    expect(rootLock).toBeGreaterThan(actorLock);
    expect(deletion).toBeGreaterThan(rootLock);
    executedQueries.length = 0;
    await generic.recordSession(
      a,
      {
        name: "No stable client ID",
        startedAt: new Date(Date.now() - 10000).toISOString(),
        completedAt: new Date().toISOString(),
        status: "completed",
        exercises: [],
      },
      (userId, sessionId, tx) =>
        new PersonalRecordsRepository().recordPRsForSession(
          userId,
          sessionId,
          tx,
        ),
    );
    const newActorLock = executedQueries.findIndex(
      (q) => q.includes('"together_actors"') && q.includes("for update"),
    );
    const insertion = executedQueries.findIndex((q) =>
      q.startsWith('insert into "workout_sessions"'),
    );
    expect(newActorLock).toBeGreaterThanOrEqual(0);
    expect(insertion).toBeGreaterThan(newActorLock);
  });
  it("preserves solo set hierarchy and permits edits that retain the same parent", async () => {
    const generic = new SessionRepository();
    const sessionId = key();
    await db
      .insert(schema.workoutSessions)
      .values({ id: sessionId, userId: a, name: "Solo" });
    const exerciseRow = await generic.addExercise({
      sessionId,
      exerciseId: exercise,
      sortOrder: 0,
    });
    const set = await generic.addSet({
      sessionExerciseId: exerciseRow.id,
      setNumber: 1,
      reps: 4,
    });
    expect(
      (await generic.getSetInSession(sessionId, exerciseRow.id, set.id, a))?.id,
    ).toBe(set.id);
    expect(
      await generic.getSetInSession(sessionId, exerciseRow.id, set.id, b),
    ).toBeNull();
    expect(
      await generic.getSetInSession(key(), exerciseRow.id, set.id, a),
    ).toBeNull();
    expect(
      await generic.getSetInSession(sessionId, key(), set.id, a),
    ).toBeNull();
    expect(
      await generic.updateSet(set.id, a, {
        sessionExerciseId: exerciseRow.id,
        reps: 8,
      }),
    ).toMatchObject({ reps: 8, sessionExerciseId: exerciseRow.id });
    expect(await generic.updateSet(set.id, b, { reps: 20 })).toBeNull();
  });
  it("keeps the reviewed result table server-only after migration rerun and rollback/reapply", async () => {
    expect(
      (
        await pg.query<{ enabled: boolean }>(
          "SELECT relrowsecurity AS enabled FROM pg_class WHERE relname='together_reviewed_results'",
        )
      ).rows[0].enabled,
    ).toBe(true);
    for (const role of ["anon", "authenticated"])
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"])
        expect(
          (
            await pg.query<{ ok: boolean }>(
              "SELECT has_table_privilege($1,'together_reviewed_results',$2) AS ok",
              [role, privilege],
            )
          ).rows[0].ok,
        ).toBe(false);
  });
});
