import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { is, SQL, eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import * as schema from "@persistence/db/schema";
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@persistence/db/client", () => ({ getDb: () => holder.db }));
import {
  writeRecoveredHistory,
  recomputeRecoveredEffects,
  type RecoveredHistoryInput,
} from "../recoveredRecording";
import type { TogetherTx } from "../shared";
import { VolumeRepository } from "../../repositories/volumeRepository";
let pg: PGlite;
let db: ReturnType<typeof drizzle>;
const actor = randomUUID(),
  other = randomUUID(),
  exercise = randomUUID();
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
  db = drizzle(pg, { schema });
  holder.db = db;
});

beforeEach(async () => {
  await pg.exec(
    "TRUNCATE profiles, exercises, workout_sessions, session_exercises, exercise_sets, personal_records, user_streaks, user_achievements, achievements, weekly_volume_per_user, volume_by_muscle_per_user CASCADE",
  );
  await db.insert(schema.profiles).values([
    { id: actor, fullName: "Owner", timezone: "Europe/London" },
    { id: other, fullName: "Other" },
  ]);
  await db
    .insert(schema.exercises)
    .values({ id: exercise, name: "Squat", category: "strength" });
});
afterAll(async () => {
  await pg.close();
});
function input(weight = 60): RecoveredHistoryInput {
  const pid = randomUUID();
  return {
    historyId: null,
    clientRecordId: randomUUID(),
    startedAt: new Date("2026-08-01T10:00:00Z"),
    completedAt: new Date("2026-08-01T11:00:00Z"),
    plan: {
      name: "Recovered",
      exercises: [
        { planExerciseId: pid, exerciseId: exercise, order: 0, targetSets: 1 },
      ],
    },
    execution: {
      exercises: [
        {
          planExerciseId: pid,
          skipped: false,
          sets: [
            { setId: randomUUID(), weightKg: weight, reps: 5, completed: true },
          ],
        },
      ],
    },
    exerciseDefinitions: {
      [exercise]: {
        name: "Squat",
        category: "strength",
        primaryMuscles: [],
        createdBy: null,
      },
    },
  };
}
const write = (value: RecoveredHistoryInput, uid = actor) =>
  db.transaction((tx) =>
    writeRecoveredHistory(tx as unknown as TogetherTx, uid, value),
  );
it("retains one history and stable sets on retry, then rebuilds a downward PR from other history", async () => {
  const previous = input(50);
  await write(previous);
  const value = input(80);
  const id = await write(value);
  const firstSets = await db
    .select({ id: schema.exerciseSets.id })
    .from(schema.exerciseSets);
  expect(await write(value)).toBe(id);
  expect(
    await db.select({ id: schema.exerciseSets.id }).from(schema.exerciseSets),
  ).toEqual(firstSets);
  value.historyId = id;
  value.execution.exercises[0].sets[0].weightKg = 30;
  value.completedAt = new Date("2026-09-20T12:00:00Z");
  expect(await write(value)).toBe(id);
  expect(await db.select().from(schema.workoutSessions)).toHaveLength(2);
  const [root] = await db
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.id, id!));
  expect(root.completedAt?.toISOString()).toBe("2026-08-01T11:00:00.000Z");
  const prs = await db.select().from(schema.personalRecords);
  expect(prs.find((p) => p.recordType === "max_weight")?.value).toBe("50.00");
  expect(prs.every((p) => p.setId !== null)).toBe(true);
});
it("empty initial recovery writes nothing; removing all sets cancels original identity and removes PRs", async () => {
  const empty = input();
  empty.execution.exercises = [];
  expect(await write(empty)).toBeNull();
  const value = input();
  value.historyId = await write(value);
  value.execution.exercises = [];
  expect(await write(value)).toBe(value.historyId);
  expect(await db.select().from(schema.exerciseSets)).toEqual([]);
  expect(await db.select().from(schema.personalRecords)).toEqual([]);
  expect((await db.select().from(schema.workoutSessions))[0].status).toBe(
    "cancelled",
  );
});
it("recreates deleted captured custom exercises as a private owner copy", async () => {
  const value = input();
  value.exerciseDefinitions[exercise].createdBy = other;
  await db.delete(schema.exercises).where(eq(schema.exercises.id, exercise));
  await write(value);
  const [copy] = await db.select().from(schema.exercises);
  expect(copy).toMatchObject({
    createdBy: actor,
    isPublic: false,
    name: "Squat",
  });
  expect(copy.id).not.toBe(exercise);
});
it("rejects wrong owner and rolls back all history on caller failure", async () => {
  const value = input();
  value.historyId = await write(value);
  await expect(write(value, other)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const another = input();
  await expect(
    db.transaction(async (tx) => {
      await writeRecoveredHistory(tx as unknown as TogetherTx, actor, another);
      throw new Error("receipt failed");
    }),
  ).rejects.toThrow("receipt failed");
  expect(await db.select().from(schema.workoutSessions)).toHaveLength(1);
});
it("rebuilds historical volume and reverses the sole workout streak inside the caller transaction", async () => {
  const value = input();
  value.historyId = await write(value);
  await db.transaction((tx) =>
    recomputeRecoveredEffects(
      actor,
      [value.completedAt],
      tx as unknown as TogetherTx,
    ),
  );
  expect(
    (await db.select().from(schema.weeklyVolumePerUser)).find(
      (w) => w.weekStart === "2026-07-27",
    ),
  ).toMatchObject({ volumeKg: "300", sessionCount: 1 });
  expect(await db.select().from(schema.userStreaks)).toHaveLength(1);
  value.execution.exercises = [];
  await write(value);
  await db.transaction((tx) =>
    recomputeRecoveredEffects(
      actor,
      [value.completedAt],
      tx as unknown as TogetherTx,
    ),
  );
  expect(
    (await db.select().from(schema.weeklyVolumePerUser)).find(
      (w) => w.weekStart === "2026-07-27",
    ),
  ).toMatchObject({ volumeKg: "0", sessionCount: 0 });
  expect(await db.select().from(schema.userStreaks)).toEqual([]);
});

it("repairs monthly muscle volume, lowers longest workout streak and preserves earned achievements and habit streaks", async () => {
  const muscle = randomUUID(),
    award = randomUUID();
  await db.insert(schema.muscleGroups).values({ id: muscle, name: "quads" });
  await db
    .update(schema.exercises)
    .set({ primaryMuscles: [muscle] })
    .where(eq(schema.exercises.id, exercise));
  await db.insert(schema.achievements).values({
    id: award,
    name: "First week",
    category: "streak",
    requirements: { streak_type: "workout_streak", threshold: 1 },
  });
  await db.insert(schema.userStreaks).values({
    userId: actor,
    streakType: "habit_streak",
    period: "daily",
    currentCount: 9,
    longestCount: 9,
    lastPeriodEnd: "2026-08-01",
  });
  const first = input(),
    second = input();
  first.historyId = await write(first);
  second.startedAt = new Date("2026-08-08T10:00:00Z");
  second.completedAt = new Date("2026-08-08T11:00:00Z");
  second.historyId = await write(second);
  const effects = () =>
    db.transaction((tx) =>
      recomputeRecoveredEffects(
        actor,
        [first.completedAt, second.completedAt],
        tx as unknown as TogetherTx,
      ),
    );
  await effects();
  expect(
    (await db.select().from(schema.userStreaks)).find(
      (s) => s.streakType === "workout_streak",
    )?.longestCount,
  ).toBe(2);
  expect(
    (await db.select().from(schema.volumeByMusclePerUser)).find(
      (v) => v.windowStart === "2026-08-01",
    )?.volumeKg,
  ).toBe("600");
  second.execution.exercises = [];
  await write(second);
  await effects();
  expect(
    (await db.select().from(schema.userStreaks)).find(
      (s) => s.streakType === "workout_streak",
    )?.longestCount,
  ).toBe(1);
  expect(
    (await db.select().from(schema.volumeByMusclePerUser)).find(
      (v) => v.windowStart === "2026-08-01",
    )?.volumeKg,
  ).toBe("300");
  first.execution.exercises = [];
  await write(first);
  await effects();
  expect(
    (await db.select().from(schema.volumeByMusclePerUser)).filter(
      (v) => v.windowStart === "2026-08-01",
    ),
  ).toEqual([]);
  expect(await db.select().from(schema.userAchievements)).toHaveLength(1);
  expect(await db.select().from(schema.userStreaks)).toMatchObject([
    { streakType: "habit_streak", currentCount: 9, longestCount: 9 },
  ]);
});

it("transaction-injected volume readers see uncommitted recovery and all projections roll back together", async () => {
  const value = input();
  const muscle = randomUUID();
  await db
    .insert(schema.muscleGroups)
    .values({ id: muscle, name: "transaction-muscle" });
  await db
    .update(schema.exercises)
    .set({ primaryMuscles: [muscle] })
    .where(eq(schema.exercises.id, exercise));
  await expect(
    db.transaction(async (tx) => {
      const transaction = tx as unknown as TogetherTx;
      value.historyId = await writeRecoveredHistory(transaction, actor, value);
      await recomputeRecoveredEffects(actor, [value.completedAt], transaction);
      const volume = new VolumeRepository(transaction);
      expect(
        await volume.dailyVolume(
          actor,
          "Europe/London",
          "2026-08-01",
          "2026-08-31",
        ),
      ).toEqual([{ date: "2026-08-01", volumeKg: 300 }]);
      expect(await volume.getWeeklyRow(actor, "2026-07-27")).toEqual({
        volumeKg: 300,
        sessionCount: 1,
      });
      expect(
        await volume.getVolumeByMuscle(actor, "month", "2026-08-01"),
      ).toEqual([{ muscle: "transaction-muscle", kg: 300 }]);
      expect(await volume.userIdsWithCompletedSessions()).toEqual([actor]);
      value.execution.exercises[0].sets[0].weightKg = 0;
      await writeRecoveredHistory(transaction, actor, value);
      await recomputeRecoveredEffects(actor, [value.completedAt], transaction);
      expect(
        await volume.dailyVolume(
          actor,
          "Europe/London",
          "2026-08-01",
          "2026-08-31",
        ),
      ).toEqual([{ date: "2026-08-01", volumeKg: 0 }]);
      expect(await volume.getWeeklyRow(actor, "2026-07-27")).toEqual({
        volumeKg: 0,
        sessionCount: 1,
      });
      expect(
        await volume.getVolumeByMuscle(actor, "month", "2026-08-01"),
      ).toEqual([]);
      throw new Error("rollback recovery and projections");
    }),
  ).rejects.toThrow("rollback recovery and projections");
  expect(await db.select().from(schema.workoutSessions)).toEqual([]);
  expect(await db.select().from(schema.weeklyVolumePerUser)).toEqual([]);
  expect(await db.select().from(schema.volumeByMusclePerUser)).toEqual([]);
  expect(await db.select().from(schema.userStreaks)).toEqual([]);
});
