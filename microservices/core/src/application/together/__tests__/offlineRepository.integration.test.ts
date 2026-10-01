import { generateKeyPairSync, randomUUID } from "node:crypto";
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
  TogetherOfflineRepository,
  type RecoveryUpload,
} from "../offlineRepository";
import {
  signPayload,
  verifyCredential,
  verifySignature,
  type Registration,
} from "../offlineIdentity";
import { requestHash } from "../shared";
import type { RecoveryCommand } from "../offlineRecovery";
let pg: PGlite;
let db: ReturnType<typeof drizzle>;
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  exercise = randomUUID(),
  otherExercise = randomUUID();
const key = () => randomUUID();
const repo = new TogetherOfflineRepository();
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
const keys = () => {
  const p = generateKeyPairSync("ed25519");
  return {
    privateKey: p.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
    publicKey: p.publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
};
const authority = keys(),
  device = keys();
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
  await pg.exec(
    readFileSync(
      new URL(
        "../../../../../../supabase/migrations/20261001120000_together_reviewed_results.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  db = drizzle(pg, { schema });
  holder.db = db;
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await pg.exec(
    "TRUNCATE profiles,subscription_tiers,user_subscriptions,friendships CASCADE",
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
  vi.stubEnv("TOGETHER_ENABLED", "true");
  vi.stubEnv(
    "TOGETHER_OFFLINE_AUTHORITY",
    JSON.stringify({
      keyId: "test",
      privateKey: authority.privateKey,
      publicKeys: { test: authority.publicKey },
    }),
  );
});
afterAll(async () => {
  await pg.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
async function register(actor = a) {
  const requestId = key();
  const proof = signPayload<Registration>(
    {
      kind: "together-register-v1",
      userId: actor,
      deviceId: key(),
      publicKey: device.publicKey,
      requestId,
      timestamp: Date.now(),
    },
    device.privateKey,
  );
  return {
    proof,
    requestId,
    credential: await repo.register(actor, requestId, proof),
  };
}
async function upload(): Promise<RecoveryUpload> {
  const { credential } = await register();
  const plan = {
    name: "Offline workout",
    exercises: [
      { planExerciseId: key(), exerciseId: exercise, order: 0, targetSets: 3 },
    ],
  };
  const base = {
    kind: "together-recovery-v1" as const,
    userId: a,
    sessionId: key(),
    executionId: key(),
    startedAt: Date.now() - 86400000,
    planHash: requestHash(plan),
  };
  const command = signPayload<RecoveryCommand>(
    {
      ...base,
      commandId: key(),
      expectedVersion: 0,
      operation: {
        type: "upsertSet",
        planExerciseId: plan.exercises[0].planExerciseId,
        set: { setId: key(), reps: 8, weightKg: 40, completed: true },
      },
    },
    device.privateKey,
  );
  return {
    credential,
    sessionId: base.sessionId,
    executionId: base.executionId,
    startedAt: base.startedAt,
    plan,
    commands: [command],
  };
}
function command(
  body: RecoveryUpload,
  operation: RecoveryCommand["operation"],
  expectedVersion: number,
) {
  return signPayload<RecoveryCommand>(
    {
      ...body.commands[0].payload,
      commandId: key(),
      operation,
      expectedVersion,
    },
    device.privateKey,
  );
}
describe("offline credentials and owner recovery persistence", () => {
  it("issues public verifiable device credentials using current entitlement bounds and stable authorised replay", async () => {
    const expiry = new Date(Date.now() + 3600000);
    await db
      .update(schema.userSubscriptions)
      .set({ expiresAt: expiry })
      .where(eq(schema.userSubscriptions.userId, a));
    const { proof, requestId, credential } = await register();
    expect(credential.payload.expiresAt).toBe(expiry.getTime());
    expect(
      verifyCredential(credential, (await repo.trust(a)).publicKeys).userId,
    ).toBe(a);
    expect(await repo.register(a, requestId, proof)).toEqual(credential);
    expect(await db.select().from(schema.togetherOfflineDevices)).toHaveLength(
      1,
    );
    const revokeKey = key();
    expect(await repo.revoke(a, proof.payload.deviceId, revokeKey)).toEqual({
      revoked: true,
    });
    expect(await repo.revoke(a, proof.payload.deviceId, revokeKey)).toEqual({
      revoked: true,
    });
    await expect(repo.register(a, requestId, proof)).rejects.toMatchObject({
      code: "DEVICE_REVOKED",
    });
  });
  it("rejects foreign registration proof, new-key reuse, stale or tampered proof and unpaid renewal", async () => {
    const { proof, requestId } = await register();
    await expect(repo.register(b, requestId, proof)).rejects.toMatchObject({
      code: "INVALID_PROOF",
    });
    await expect(repo.register(a, key(), proof)).rejects.toMatchObject({
      code: "INVALID_PROOF",
    });
    const stale = signPayload(
      { ...proof.payload, timestamp: Date.now() - 3600000 },
      device.privateKey,
    );
    await expect(repo.register(a, requestId, stale)).rejects.toMatchObject({
      code: "INVALID_PROOF",
    });
    const privateId = key();
    await expect(
      repo.register(
        a,
        privateId,
        signPayload(
          {
            ...proof.payload,
            requestId: privateId,
            publicKey: device.privateKey,
          },
          device.privateKey,
        ),
      ),
    ).rejects.toMatchObject({ code: "INVALID_PROOF" });
    const another = keys(),
      id = key();
    await expect(
      repo.register(
        a,
        id,
        signPayload(
          { ...proof.payload, requestId: id, publicKey: another.publicKey },
          another.privateKey,
        ),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await db.update(schema.userSubscriptions).set({ expiresAt: new Date(0) });
    await expect(repo.register(a, requestId, proof)).rejects.toMatchObject({
      code: "PAID_REQUIRED",
    });
  });
  it("issues only current unblocked pair evidence and reauthorizes old receipts", async () => {
    await expect(
      repo.friendship(a, b.toUpperCase(), key()),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    await expect(repo.friendship(a, b, key())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(repo.friendship(a, a, key())).rejects.toMatchObject({
      code: "INVALID_SCHEMA",
    });
    await db
      .insert(schema.friendships)
      .values({ userId: a, friendId: b, status: "accepted", initiatedBy: a });
    const k = key(),
      proof = await repo.friendship(a, b, k);
    expect(verifySignature(proof, authority.publicKey).users.sort()).toEqual(
      [a, b].sort(),
    );
    expect(await repo.friendship(a, b, k)).toEqual(proof);
    await db.insert(schema.socialBlocks).values({ actorId: b, subjectId: a });
    await expect(repo.friendship(a, b, k)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("reconstructs a signed journal, retries without duplicates, and exposes only an owner review candidate", async () => {
    const body = await upload(),
      k = key();
    const result = await repo.recover(a, k, body);
    expect(result).toMatchObject({
      status: "stored_for_review",
      historySaved: false,
      sharingActive: false,
      revision: 1,
      startedAt: body.startedAt,
    });
    expect(result.execution.exercises[0].sets).toHaveLength(1);
    expect(await repo.recover(a, k, body)).toEqual(result);
    expect(await repo.recover(a, key(), body)).toEqual(result);
    expect(await repo.getRecovery(a, body.executionId)).toMatchObject({
      revision: 1,
      execution: result.execution,
    });
    await expect(repo.getRecovery(b, body.executionId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(repo.recover(b, key(), body)).rejects.toMatchObject({
      code: "INVALID_PROOF",
    });
    expect(await db.select().from(schema.togetherOfflineCommands)).toHaveLength(
      1,
    );
    expect(await db.select().from(schema.workoutSessions)).toHaveLength(0);
    expect(await db.select().from(schema.togetherParticipants)).toHaveLength(0);
  });
  it("retains own recovery after expiry, device revocation, blocks, lost entitlement and peer deletion", async () => {
    const body = await upload();
    await repo.revoke(a, body.credential.payload.deviceId, key());
    await db.insert(schema.socialBlocks).values({ actorId: b, subjectId: a });
    await db.delete(schema.profiles).where(eq(schema.profiles.id, b));
    await db.update(schema.userSubscriptions).set({ expiresAt: new Date(0) });
    vi.spyOn(Date, "now").mockReturnValue(
      body.credential.payload.expiresAt + 1,
    );
    expect((await repo.recover(a, key(), body)).status).toBe(
      "stored_for_review",
    );
    const invalid = {
      ...body,
      credential: signPayload(
        { ...body.credential.payload, deviceId: key() },
        authority.privateKey,
      ),
    };
    await expect(repo.recover(a, key(), invalid)).rejects.toMatchObject({
      code: "INVALID_PROOF",
    });
  });
  it("rejects gaps, mutated command identities, context collisions and peer-authored commands atomically", async () => {
    const body = await upload();
    const gap = command(body, { type: "rest", endsAt: null }, 2);
    await expect(
      repo.recover(a, key(), { ...body, commands: [...body.commands, gap] }),
    ).rejects.toMatchObject({ code: "VERSION_GAP" });
    expect(
      await db.select().from(schema.togetherOfflineExecutions),
    ).toHaveLength(0);
    await repo.recover(a, key(), body);
    const changed = signPayload(
      {
        ...body.commands[0].payload,
        operation: { type: "rest" as const, endsAt: null },
      },
      device.privateKey,
    );
    await expect(
      repo.recover(a, key(), { ...body, commands: [changed] }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await expect(
      repo.recover(a, key(), { ...body, sessionId: key() }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await expect(
      repo.recover(a, key(), { ...body, executionId: key() }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await expect(
      repo.recover(a, key(), { ...body, startedAt: body.startedAt - 1 }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await expect(
      repo.recover(a, key(), {
        ...body,
        commands: [
          signPayload(
            { ...body.commands[0].payload, userId: b },
            device.privateKey,
          ),
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROOF" });
  });
  it("applies personal operations with immutable acknowledged exercise identity and retained tombstones", async () => {
    const body = await upload(),
      pid = body.plan.exercises[0].planExerciseId;
    const first = command(
      body,
      { type: "substitute", planExerciseId: pid, exerciseId: otherExercise },
      0,
    );
    const set = command(body, body.commands[0].payload.operation, 1);
    const update = command(body, body.commands[0].payload.operation, 2);
    const skip = command(
      body,
      { type: "skip", planExerciseId: pid, skipped: true },
      3,
    );
    const rest = command(body, { type: "rest", endsAt: null }, 4);
    const result = await repo.recover(a, key(), {
      ...body,
      commands: [first, set, update, skip, rest],
    });
    expect(result.revision).toBe(5);
    expect(result.execution.exercises[0].sets).toHaveLength(1);
    expect(result.execution.exercises[0].skipped).toBe(true);
    const ownSet = result.execution.exercises[0].sets[0];
    const remove = command(
      body,
      { type: "removeSet", planExerciseId: pid, setId: ownSet.setId },
      5,
    );
    await repo.recover(a, key(), { ...body, commands: [remove] });
    await expect(
      repo.recover(a, key(), {
        ...body,
        commands: [
          command(
            body,
            { type: "substitute", planExerciseId: pid, exerciseId: null },
            6,
          ),
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(
      (
        await repo.recover(a, key(), {
          ...body,
          commands: [
            command(
              body,
              {
                type: "substitute",
                planExerciseId: pid,
                exerciseId: otherExercise,
              },
              6,
            ),
          ],
        })
      ).revision,
    ).toBe(7);
    await expect(
      repo.recover(a, key(), {
        ...body,
        commands: [
          command(
            body,
            { type: "skip", planExerciseId: key(), skipped: true },
            7,
          ),
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
  });
  it("rejects cloud collisions, bad schemas and authorization loss before prior HTTP receipts", async () => {
    const body = await upload();
    await db.insert(schema.togetherSessions).values({
      id: body.sessionId,
      hostId: a,
      clientDraftId: key(),
      promotionHash: "test",
      plan: body.plan,
      expiresAt: new Date(Date.now() + 1000),
    });
    await expect(repo.recover(a, key(), body)).rejects.toMatchObject({
      code: "CLOUD_SESSION_CONFLICT",
    });
    await db.delete(schema.togetherSessions);
    await expect(
      repo.recover(a, key(), { ...body, commands: [] }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    const k = key();
    await repo.recover(a, k, body);
    await db
      .update(schema.profiles)
      .set({ deletedAt: new Date() })
      .where(eq(schema.profiles.id, a));
    await expect(repo.recover(a, k, body)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    vi.stubEnv("TOGETHER_ENABLED", "false");
    await expect(repo.getRecovery(a, body.executionId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("rejects uppercase signed identifiers before inserting a recovery execution", async () => {
    const body = await upload();
    await expect(
      repo.recover(a, key(), {
        ...body,
        sessionId: body.sessionId.toUpperCase(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    const invalid = signPayload(
      {
        ...body.commands[0].payload,
        commandId: body.commands[0].payload.commandId.toUpperCase(),
      },
      device.privateKey,
    );
    await expect(
      repo.recover(a, key(), { ...body, commands: [invalid] }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    await expect(
      repo.recover(a, key(), {
        ...body,
        plan: {
          ...body.plan,
          exercises: body.plan.exercises.map((e) => ({
            ...e,
            planExerciseId: e.planExerciseId.toUpperCase(),
          })),
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    expect(
      await db.select().from(schema.togetherOfflineExecutions),
    ).toHaveLength(0);
  });
  it("migration is rerunnable, denies direct app-role access and rollback preserves existing tables", async () => {
    for (const table of [
      "together_offline_devices",
      "together_offline_executions",
      "together_offline_commands",
    ]) {
      expect(
        (
          await pg.query<{ enabled: boolean }>(
            "SELECT relrowsecurity AS enabled FROM pg_class WHERE relname=$1",
            [table],
          )
        ).rows[0].enabled,
      ).toBe(true);
      for (const role of ["anon", "authenticated"])
        expect(
          (
            await pg.query<{ ok: boolean }>(
              "SELECT has_table_privilege($1,$2,'SELECT') AS ok",
              [role, table],
            )
          ).rows[0].ok,
        ).toBe(false);
    }
    const rollback = readFileSync(
      new URL(
        "../../../../../../supabase/rollbacks/20260930160418_together_offline_recovery.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await pg.exec(rollback);
    await pg.exec(rollback);
    expect(await db.select().from(schema.profiles)).toHaveLength(3);
    await pg.exec(offlineMigration);
  });
});
