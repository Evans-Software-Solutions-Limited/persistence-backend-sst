/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import { withTogetherWorkout } from "../../storage/withTogetherWorkout";
import { InMemoryStorageAdapter } from "../../storage/__tests__/in-memory-storage.adapter";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TogetherWorkoutCheckpoint,
  type WorkoutAuthority,
} from "../workoutCheckpoint";
import {
  TogetherJournal,
  type TogetherJournalDatabase,
} from "../../storage/togetherJournal";
import {
  publicKeyPem,
  signPayload,
  type Credential,
  type Signed,
  requestHash,
} from "../security/identity";
import { ok, fail } from "../../../shared/errors/result";
import type {
  TogetherRecoveryApi,
  TogetherRecoveryCandidate,
  TogetherRecoveryCommand,
  TogetherRecoveryExecution,
  TogetherRecoveryResult,
} from "../../../domain/ports/togetherOfflineApi.port";
import { commandFromEnvelope, readOwnerCommand } from "../localCommand";
import type { WorkoutSession } from "../../../domain/models/session";
const userId = randomUUID();
const seed = new Uint8Array(32).fill(42);
const credential = signPayload<Credential>(
  {
    kind: "together-device-v1",
    keyId: "test",
    userId,
    deviceId: randomUUID(),
    publicKey: publicKeyPem(seed),
    issuedAt: 1,
    expiresAt: 9999999999999,
  },
  new Uint8Array(32).fill(6),
);
function draft(): WorkoutSession {
  return {
    id: "local-workout",
    userId,
    workoutId: null,
    name: "Squats",
    status: "in_progress",
    startedAt: "2026-10-04T09:00:00.000Z",
    completedAt: null,
    notes: "Preserve me",
    exercises: [
      {
        id: "local-exercise",
        sessionId: "local-workout",
        exerciseId: "12345678-1111-4111-8111-111111111111",
        exerciseName: "Squat",
        category: "strength",
        sortOrder: 0,
        supersetGroup: null,
        isSubstituted: false,
        originalExerciseId: null,
        notes: "Slow tempo",
        sets: [
          {
            id: "local-set",
            sessionExerciseId: "local-exercise",
            setNumber: 1,
            weightKg: 25,
            reps: 8,
            rpe: null,
            durationSeconds: null,
            distanceMeters: null,
            isCompleted: false,
            completedAt: null,
          },
        ],
      },
    ],
  };
}
// Sequential edit fixtures explicitly take the current read version. Race tests
// below retain the original read token and call save directly instead.
function saveCurrent(
  runtime: TogetherWorkoutCheckpoint,
  user: string,
  session: WorkoutSession,
) {
  const current = runtime.read(user, session.id);
  runtime.save(user, {
    ...session,
    ...(current?.together ? { together: current.together } : {}),
  });
}
function database(db: DatabaseSync): TogetherJournalDatabase {
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, p) => db.prepare(sql).run(...p),
    getFirstSync: <T>(sql: string, p: (string | number | null)[]) =>
      (db.prepare(sql).get(...p) as T | undefined) ?? null,
    getAllSync: <T>(sql: string, p: (string | number | null)[]) =>
      db.prepare(sql).all(...p) as T[],
    withTransactionSync: (action) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        action();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
describe("own workout durable checkpoint (real SQLite and signatures)", () => {
  let db: DatabaseSync,
    adapter: TogetherJournalDatabase,
    runtime: TogetherWorkoutCheckpoint,
    account: string | null,
    authority: WorkoutAuthority | undefined;
  const sends: ReturnType<typeof jest.fn>[] = [];
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    adapter = database(db);
    account = userId;
    const send = jest.fn(async () => {});
    sends.push(send);
    authority = {
      credential,
      seed: seed.slice(),
      sessionId: randomUUID(),
      executionId: randomUUID(),
      sharing: "active",
      send,
    };
    runtime = new TogetherWorkoutCheckpoint(
      adapter,
      () => account,
      () => authority,
      randomUUID,
    );
  });
  afterEach(() => db.close());
  const entries = () =>
    new TogetherJournal(adapter, userId).list(
      authority!.sessionId,
      authority!.executionId,
    );
  it("atomically preserves full personal snapshot and projects already logged false-completed sets with stable IDs", async () => {
    const source = draft();
    await runtime.promote(source);
    expect(runtime.read(userId, source.id)).toEqual({
      ...source,
      together: {
        sessionId: authority!.sessionId,
        executionId: authority!.executionId,
        checkpointVersion: expect.any(String),
      },
    });
    const list = entries();
    expect(list).toHaveLength(1);
    const payload = readOwnerCommand(
      {
        commandId: list[0].commandId,
        sessionId: list[0].sessionId,
        executionId: list[0].executionId,
        payload: list[0].payload,
      },
      credential,
    );
    expect(payload).toMatchObject({
      expectedVersion: 0,
      startedAt: Date.parse(source.startedAt),
      operation: {
        type: "upsertSet",
        set: { reps: 8, weightKg: 25, completed: true },
      },
    });
    expect(payload.operation).not.toEqual(
      expect.objectContaining({ planExerciseId: "local-exercise" }),
    );
    await runtime.promote(source);
    saveCurrent(runtime, userId, source);
    expect(entries()).toHaveLength(1);
    expect(runtime.status(userId, source.id)).toMatchObject({
      sharing: "active",
      pendingCount: 1,
      receivedCount: 0,
    });
    new TogetherJournal(adapter, userId).recordPeerReceipt(
      list[0],
      randomUUID(),
    );
    expect(runtime.status(userId, source.id)).toMatchObject({
      pendingCount: 0,
      receivedCount: 1,
    });
  });
  it("rejects a stale storage edit after a delegated set without signing deletion, then saves a fresh edit", async () => {
    const base = new InMemoryStorageAdapter();
    const storage = withTogetherWorkout(base, runtime);
    storage.cacheActiveSession(userId, draft());
    await runtime.promote(draft());
    const stale = storage.getActiveSession(userId)!;
    const planExerciseId = runtime.getPlan(userId, stale.id)!.exercises[0]
      .planExerciseId;
    const delegatedId = randomUUID();
    runtime.applyOwnOperation(
      userId,
      stale.id,
      runtime.getOwnExecution(userId, stale.id)!.revision,
      {
        type: "upsertSet",
        planExerciseId,
        set: { setId: delegatedId, reps: 12, weightKg: 35, completed: true },
      },
    );
    const durable = runtime.read(userId, stale.id)!;
    const journalBefore = entries();
    const mirrorBefore = base.getActiveSession(userId);
    stale.exercises[0].sets[0].reps = 9;
    expect(() => storage.cacheActiveSession(userId, stale)).toThrow(
      "workout-version-conflict",
    );
    expect(runtime.read(userId, stale.id)).toEqual(durable);
    expect(entries()).toEqual(journalBefore);
    expect(base.getActiveSession(userId)).toEqual(mirrorBefore);
    const fresh = storage.getActiveSession(userId)!;
    fresh.exercises[0].sets[0].reps = 9;
    storage.cacheActiveSession(userId, fresh);
    expect(
      storage.getActiveSession(userId)!.exercises[0].sets.map((s) => s.reps),
    ).toEqual([9, 12]);
    expect(
      runtime.getOwnExecution(userId, fresh.id)!.execution.exercises[0].sets,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ setId: delegatedId, reps: 12, weightKg: 35 }),
      ]),
    );
    expect(entries()).toHaveLength(journalBefore.length + 1);
    expect(base.getActiveSession(userId)).toEqual(
      storage.getActiveSession(userId),
    );
    expect(() => runtime.save(userId, draft())).toThrow(
      "workout-version-conflict",
    );
  });
  it("versions private-only edits even when signed execution revision does not change", async () => {
    await runtime.promote(draft());
    const stale = runtime.getActive(userId)!;
    const fresh = runtime.read(userId, stale.id)!;
    const revision = runtime.getOwnExecution(userId, stale.id)!.revision;
    fresh.notes = "New private note";
    runtime.save(userId, fresh);
    expect(runtime.getOwnExecution(userId, stale.id)!.revision).toBe(revision);
    stale.exercises[0].sets[0].reps = 10;
    expect(() => runtime.save(userId, stale)).toThrow(
      "workout-version-conflict",
    );
    expect(runtime.read(userId, stale.id)?.notes).toBe("New private note");
    const latest = runtime.read(userId, stale.id)!;
    runtime.save(userId, latest);
    expect(runtime.read(userId, stale.id)).toEqual(latest);
  });
  it("edits, partial values, removed sets and newly completed sets produce ordered immutable operations", async () => {
    const s = draft();
    await runtime.promote(s);
    s.exercises[0].sets[0].reps = 9;
    saveCurrent(runtime, userId, s);
    s.exercises[0].sets[0].weightKg = null;
    saveCurrent(runtime, userId, s);
    saveCurrent(runtime, userId, s);
    s.exercises[0].sets.push({
      ...s.exercises[0].sets[0],
      id: "another",
      weightKg: 30,
      reps: 10,
    });
    saveCurrent(runtime, userId, s);
    s.exercises[0].sets.splice(1, 1);
    saveCurrent(runtime, userId, s);
    const commands = entries().map((e) =>
      readOwnerCommand(
        {
          commandId: e.commandId,
          sessionId: e.sessionId,
          executionId: e.executionId,
          payload: e.payload,
        },
        credential,
      ),
    );
    expect(commands.map((c) => c.expectedVersion)).toEqual([0, 1, 2, 3, 4]);
    expect(commands.map((c) => c.operation.type)).toEqual([
      "upsertSet",
      "upsertSet",
      "removeSet",
      "upsertSet",
      "removeSet",
    ]);
    expect(commands[0].operation.planExerciseId).toBe(
      commands[1].operation.planExerciseId,
    );
    expect(commands[2].operation.setId).toBe(
      (commands[0].operation.set as { setId: string }).setId,
    );
    expect(
      runtime.read(userId, s.id)!.exercises[0].sets[0].weightKg,
    ).toBeNull();
  });
  it("blank/partial sets are preserved without fabricating zero operations", async () => {
    const s = draft();
    s.exercises[0].sets[0].reps = null;
    await runtime.promote(s);
    expect(entries()).toEqual([]);
    expect(runtime.read(userId, s.id)!.exercises).toEqual(s.exercises);
  });
  it("journal and full checkpoint roll back together when the snapshot write fails", async () => {
    const original = adapter.runSync;
    adapter.runSync = (sql, p) => {
      if (sql.includes("INSERT INTO together_workout_checkpoint"))
        throw new Error("disk full");
      return original(sql, p);
    };
    await expect(runtime.promote(draft())).rejects.toThrow("disk full");
    expect(entries()).toEqual([]);
    expect(runtime.read(userId, draft().id)).toBeNull();
    expect(sends.at(-1)).not.toHaveBeenCalled();
    adapter.runSync = original;
    await runtime.promote(draft());
    const s = draft();
    s.exercises[0].sets[0].reps = 20;
    adapter.runSync = (sql, p) => {
      if (sql.includes("INSERT INTO together_workout_checkpoint"))
        throw new Error("disk full");
      return original(sql, p);
    };
    expect(() => saveCurrent(runtime, userId, s)).toThrow("disk full");
    expect(entries()).toHaveLength(1);
    expect(runtime.read(userId, s.id)!.exercises[0].sets[0].reps).toBe(8);
  });
  it("retains unsigned durable intents after authority leaves and isolates account access", async () => {
    const s = draft();
    await runtime.promote(s);
    authority = undefined;
    s.exercises[0].sets[0].reps = 10;
    saveCurrent(runtime, userId, s);
    expect(runtime.status(userId, s.id)).toMatchObject({
      sharing: "local-only",
      pendingCount: 2,
    });
    account = randomUUID();
    expect(runtime.read(userId, s.id)).toBeNull();
    expect(runtime.status(userId, s.id)).toBeNull();
    expect(() => saveCurrent(runtime, userId, s)).toThrow("workout-account");
    await expect(runtime.promote(s)).rejects.toThrow("workout-account");
    account = userId;
    await expect(runtime.promote(s)).rejects.toThrow("workout-not-admitted");
    expect(() =>
      saveCurrent(runtime, userId, { ...s, userId: randomUUID() }),
    ).toThrow("workout-account");
    expect(() => saveCurrent(runtime, userId, { ...s, id: "unknown" })).toThrow(
      "workout-not-promoted",
    );
  });
  it("does not rebind an old execution to a new lobby or forged marker", async () => {
    await runtime.promote(draft());
    authority = { ...authority!, executionId: randomUUID() };
    await expect(runtime.promote(draft())).rejects.toThrow(
      "workout-already-promoted",
    );
    expect(runtime.status(userId, draft().id)?.sharing).toBe("local-only");
    await expect(
      runtime.promote({
        ...draft(),
        id: "new",
        together: { sessionId: randomUUID(), executionId: randomUUID() },
      }),
    ).rejects.toThrow("workout-already-promoted");
  });
  it("preserves local edits after network errors and callbacks that throw", async () => {
    authority!.send = jest.fn(async () => {
      throw new Error("offline");
    });
    const remove = runtime.subscribe(() => {
      throw new Error("view failure");
    });
    await runtime.promote(draft());
    expect(runtime.read(userId, draft().id)).not.toBeNull();
    remove();
    authority!.sharing = "reconnecting";
    expect(runtime.status(userId, draft().id)?.sharing).toBe("reconnecting");
  });
  it.each(["name", "startedAt", "exerciseId", "sortOrder"])(
    "pauses changed immutable %s while retaining all personal edits",
    async (key) => {
      const s = draft();
      await runtime.promote(s);
      if (key === "name") s.name = "Renamed";
      else if (key === "startedAt") s.startedAt = "2026-10-04T10:00:00Z";
      else if (key === "exerciseId") s.exercises[0].exerciseId = randomUUID();
      else s.exercises[0].sortOrder = 1;
      saveCurrent(runtime, userId, s);
      expect(runtime.status(userId, s.id)).toMatchObject({
        sharing: "paused",
        error: "workout-plan-changed",
      });
      expect(runtime.read(userId, s.id)).toMatchObject(s);
      expect(entries()).toHaveLength(1);
      saveCurrent(runtime, userId, draft());
      expect(runtime.status(userId, s.id)?.sharing).toBe("paused");
    },
  );
  const invalid: [string, (s: WorkoutSession) => void][] = [
    [
      "completed",
      (s) => {
        s.status = "completed";
      },
    ],
    [
      "coached",
      (s) => {
        s.withClient = { id: "client", name: "C", initials: "C" };
      },
    ],
    [
      "retro",
      (s) => {
        s.retrospectiveCompletedAt = "x";
      },
    ],
    [
      "retro duration",
      (s) => {
        s.retrospectiveDurationSeconds = 10;
      },
    ],
    [
      "invalid date",
      (s) => {
        s.startedAt = "bad";
      },
    ],
    [
      "negative date",
      (s) => {
        s.startedAt = "1960-01-01";
      },
    ],
    [
      "empty name",
      (s) => {
        s.name = " ";
      },
    ],
    [
      "long name",
      (s) => {
        s.name = "a".repeat(121);
      },
    ],
    [
      "empty",
      (s) => {
        s.exercises = [];
      },
    ],
    [
      "too many exercises",
      (s) => {
        s.exercises = Array(101).fill(s.exercises[0]);
      },
    ],
    [
      "missing ID",
      (s) => {
        s.exercises[0].id = "";
      },
    ],
    [
      "duplicate ID",
      (s) => {
        s.exercises.push(s.exercises[0]);
      },
    ],
    [
      "catalog",
      (s) => {
        s.exercises[0].exerciseId = "local-id";
      },
    ],
    [
      "session reference",
      (s) => {
        s.exercises[0].sessionId = "wrong";
      },
    ],
    [
      "cardio",
      (s) => {
        s.exercises[0].category = "cardio";
      },
    ],
    [
      "substitution",
      (s) => {
        s.exercises[0].isSubstituted = true;
      },
    ],
    [
      "original",
      (s) => {
        s.exercises[0].originalExerciseId = randomUUID();
      },
    ],
    [
      "superset",
      (s) => {
        s.exercises[0].supersetGroup = 1;
      },
    ],
    [
      "fraction order",
      (s) => {
        s.exercises[0].sortOrder = 1.5;
      },
    ],
    [
      "negative order",
      (s) => {
        s.exercises[0].sortOrder = -1;
      },
    ],
    [
      "order limit",
      (s) => {
        s.exercises[0].sortOrder = 100;
      },
    ],
    [
      "empty sets",
      (s) => {
        s.exercises[0].sets = [];
      },
    ],
    [
      "too many sets",
      (s) => {
        s.exercises[0].sets = Array(101).fill(s.exercises[0].sets[0]);
      },
    ],
    [
      "missing set ID",
      (s) => {
        s.exercises[0].sets[0].id = "";
      },
    ],
    [
      "duplicate set ID",
      (s) => {
        s.exercises[0].sets.push(s.exercises[0].sets[0]);
      },
    ],
    [
      "set reference",
      (s) => {
        s.exercises[0].sets[0].sessionExerciseId = "bad";
      },
    ],
    [
      "rpe",
      (s) => {
        s.exercises[0].sets[0].rpe = 5;
      },
    ],
    [
      "duration",
      (s) => {
        s.exercises[0].sets[0].durationSeconds = 5;
      },
    ],
    [
      "distance",
      (s) => {
        s.exercises[0].sets[0].distanceMeters = 5;
      },
    ],
    [
      "nonfinite weight",
      (s) => {
        s.exercises[0].sets[0].weightKg = Infinity;
      },
    ],
    [
      "negative weight",
      (s) => {
        s.exercises[0].sets[0].weightKg = -1;
      },
    ],
    [
      "weight limit",
      (s) => {
        s.exercises[0].sets[0].weightKg = 10000;
      },
    ],
    [
      "fraction reps",
      (s) => {
        s.exercises[0].sets[0].reps = 1.5;
      },
    ],
    [
      "negative reps",
      (s) => {
        s.exercises[0].sets[0].reps = -1;
      },
    ],
    [
      "reps limit",
      (s) => {
        s.exercises[0].sets[0].reps = 10001;
      },
    ],
  ];
  it.each(invalid)(
    "rejects unsupported %s before mutation and preserves edits after promotion",
    async (name, mutate) => {
      const s = draft();
      mutate(s);
      await expect(runtime.promote(s)).rejects.toThrow("workout-unsupported");
      expect(runtime.read(userId, s.id)).toBeNull();
      await runtime.promote(draft());
      saveCurrent(runtime, userId, s);
      if (name === "empty sets") {
        expect(runtime.status(userId, s.id)?.sharing).toBe("active");
        expect(entries()).toHaveLength(2);
      } else {
        expect(runtime.status(userId, s.id)).toMatchObject({
          sharing: "paused",
          error:
            name === "original"
              ? "workout-plan-changed"
              : "workout-unsupported",
        });
        expect(entries()).toHaveLength(1);
      }
    },
  );
  it("restores the one active checkpoint after account switching without a personal cache anchor", async () => {
    expect(runtime.getActive(userId)).toBeNull();
    await runtime.promote(draft());
    const original = runtime.getActive(userId)!;
    const second = draft();
    second.id = "second";
    await expect(runtime.promote(second)).rejects.toThrow(
      "workout-already-promoted",
    );
    account = null;
    expect(runtime.getActive(userId)).toBeNull();
    account = randomUUID();
    expect(runtime.getActive(account)).toBeNull();
    expect(runtime.getActive(userId)).toBeNull();
    account = userId;
    authority = undefined;
    runtime = new TogetherWorkoutCheckpoint(
      adapter,
      () => account,
      () => authority,
      randomUUID,
    );
    expect(runtime.getActive(userId)).toEqual(original);
    saveCurrent(runtime, userId, { ...original, status: "cancelled" });
    expect(runtime.getActive(userId)).toBeNull();
  });
  it("signs missing earlier intents before new versions when the same authority returns", async () => {
    const s = draft();
    await runtime.promote(s);
    const original = authority!;
    authority = undefined;
    s.exercises[0].sets[0].reps = 12;
    saveCurrent(runtime, userId, s);
    authority = original;
    s.exercises[0].sets[0].reps = 13;
    saveCurrent(runtime, userId, s);
    const rows = entries();
    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) => JSON.parse(row.payload).payload.expectedVersion),
    ).toEqual([0, 1, 2]);
    expect(runtime.status(userId, s.id)).toMatchObject({
      sharing: "active",
      pendingCount: 3,
    });
    saveCurrent(runtime, userId, s);
    expect(entries()).toHaveLength(3);
  });
  it("supports native database prototype methods without nested transactions", async () => {
    runtime = new TogetherWorkoutCheckpoint(
      Object.create(adapter),
      () => account,
      () => authority,
      randomUUID,
    );
    await runtime.promote(draft());
    expect(entries()).toHaveLength(1);
  });
  it("reopens full checkpoint and pending unsigned work with no authority or advertisement", async () => {
    const dir = mkdtempSync(join(tmpdir(), "together-workout-"));
    try {
      db.close();
      db = new DatabaseSync(join(dir, "journal.sqlite"));
      adapter = database(db);
      runtime = new TogetherWorkoutCheckpoint(
        adapter,
        () => account,
        () => authority,
        randomUUID,
      );
      const s = draft();
      delete s.exercises[0].category;
      await runtime.promote(s);
      authority = undefined;
      s.exercises[0].sets[0].reps = 11;
      saveCurrent(runtime, userId, s);
      db.close();
      db = new DatabaseSync(join(dir, "journal.sqlite"));
      adapter = database(db);
      runtime = new TogetherWorkoutCheckpoint(
        adapter,
        () => account,
        () => authority,
        randomUUID,
      );
      expect(runtime.read(userId, s.id)!.exercises).toEqual(s.exercises);
      expect(runtime.getActive(userId)?.id).toBe(s.id);
      expect(runtime.getActive(userId)?.exercises).toEqual(s.exercises);
      expect(runtime.status(userId, s.id)).toMatchObject({
        sharing: "local-only",
        pendingCount: 2,
      });
      const row = adapter.getFirstSync<{ payload: string }>(
        "SELECT payload FROM together_workout_checkpoint",
        [],
      )!;
      expect(row.payload).not.toContain('"seed"');
      expect(JSON.parse(row.payload).credential).toEqual(credential);
      expect(JSON.parse(row.payload).intents[1]).not.toHaveProperty("command");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("maps canonical own set operations with revision checks, independent skip/rest and new set IDs", async () => {
    const s = draft();
    await runtime.promote(s);
    const plan = runtime.getPlan(userId, s.id)!;
    const planExerciseId = plan.exercises[0].planExerciseId;
    const own = runtime.getOwnExecution(userId, s.id)!;
    const set = own.execution.exercises[0].sets[0];
    runtime.applyOwnOperation(userId, s.id, own.revision, {
      type: "upsertSet",
      planExerciseId,
      set: { ...set, reps: 14 },
    });
    expect(runtime.read(userId, s.id)?.exercises[0].sets[0].reps).toBe(14);
    expect(() =>
      runtime.applyOwnOperation(userId, s.id, own.revision, {
        type: "removeSet",
        planExerciseId,
        setId: set.setId,
      }),
    ).toThrow("workout-version-conflict");
    runtime.applyOwnOperation(userId, s.id, 2, {
      type: "removeSet",
      planExerciseId,
      setId: set.setId,
    });
    expect(runtime.read(userId, s.id)?.exercises[0].sets[0].reps).toBeNull();
    runtime.applyOwnOperation(userId, s.id, 3, {
      type: "skip",
      planExerciseId,
      skipped: true,
    });
    runtime.applyOwnOperation(userId, s.id, 4, {
      type: "rest",
      endsAt: "2026-10-05T10:00:00.000Z",
    });
    const newSetId = randomUUID();
    runtime.applyOwnOperation(userId, s.id, 5, {
      type: "upsertSet",
      planExerciseId,
      set: { setId: newSetId, reps: 8, weightKg: 30, completed: true },
    });
    expect(runtime.getOwnExecution(userId, s.id)).toMatchObject({
      revision: 6,
      execution: {
        restEndsAt: "2026-10-05T10:00:00.000Z",
        exercises: [{ skipped: true, sets: [{ setId: newSetId, reps: 8 }] }],
      },
    });
    runtime.applyOwnOperation(userId, s.id, 6, { type: "rest", endsAt: null });
    expect(
      runtime.getOwnExecution(userId, s.id)?.execution.restEndsAt,
    ).toBeNull();
    account = null;
    expect(runtime.getPlan(userId, s.id)).toBeNull();
    expect(runtime.getOwnExecution(userId, s.id)).toBeNull();
    expect(() =>
      runtime.applyOwnOperation(userId, s.id, 7, {
        type: "rest",
        endsAt: null,
      }),
    ).toThrow("workout-not-promoted");
  });
  it.each([
    { type: "rest", endsAt: "bad" },
    { type: "rest", endsAt: 123 },
    { type: "rest", endsAt: "2026-10-05" },
    { type: "rest", endsAt: null, extra: 1 },
    { type: "skip", skipped: "yes" },
    { type: "skip", skipped: true, extra: 1 },
    { type: "unknown" },
    { type: "removeSet", setId: "bad" },
    { type: "removeSet", setId: randomUUID(), extra: 1 },
    ...[
      { setId: "bad" },
      { reps: -1 },
      { reps: 1.5 },
      { reps: 10001 },
      { weightKg: Infinity },
      { weightKg: -1 },
      { weightKg: 10000 },
      { weightKg: "20" },
      { completed: false },
      { extra: 1 },
    ].map((change) => ({
      type: "upsertSet",
      set: {
        setId: randomUUID(),
        reps: 10,
        weightKg: 20,
        completed: true,
        ...change,
      },
    })),
    { type: "upsertSet", set: null },
    { type: "upsertSet", set: {}, extra: 1 },
  ])(
    "rejects malformed canonical operation %# without any snapshot mutation",
    async (op) => {
      await runtime.promote(draft());
      const planExerciseId = runtime.getPlan(userId, draft().id)!.exercises[0]
        .planExerciseId;
      const before = runtime.read(userId, draft().id);
      const operation = op.type === "rest" ? op : { ...op, planExerciseId };
      expect(() =>
        runtime.applyOwnOperation(userId, draft().id, 1, operation),
      ).toThrow("workout-invalid-operation");
      expect(runtime.read(userId, draft().id)).toEqual(before);
    },
  );
  it("rejects unknown exercise/set mappings and set overflow", async () => {
    const s = draft();
    await runtime.promote(s);
    const planExerciseId = runtime.getPlan(userId, s.id)!.exercises[0]
      .planExerciseId;
    expect(() =>
      runtime.applyOwnOperation(userId, s.id, 1, {
        type: "skip",
        planExerciseId: randomUUID(),
        skipped: true,
      }),
    ).toThrow("workout-invalid-operation");
    expect(() =>
      runtime.applyOwnOperation(userId, s.id, 1, {
        type: "removeSet",
        planExerciseId,
        setId: randomUUID(),
      }),
    ).toThrow("workout-unknown-set");
    s.exercises[0].sets = Array.from({ length: 100 }, (_, i) => ({
      ...s.exercises[0].sets[0],
      id: `set-${i}`,
      setNumber: i + 1,
    }));
    saveCurrent(runtime, userId, s);
    expect(() =>
      runtime.applyOwnOperation(
        userId,
        s.id,
        runtime.getOwnExecution(userId, s.id)!.revision,
        {
          type: "upsertSet",
          planExerciseId,
          set: { setId: randomUUID(), reps: 1, weightKg: 1, completed: true },
        },
      ),
    ).toThrow("workout-unknown-set");
  });
  it("projects a deliberate pre-set substitution and freezes attribution after the first logged set", async () => {
    const s = draft();
    s.exercises[0].sets[0].reps = null;
    await runtime.promote(s);
    const original = s.exercises[0].exerciseId;
    s.exercises[0].originalExerciseId = original;
    s.exercises[0].exerciseId = randomUUID();
    s.exercises[0].exerciseName = "Alternative";
    saveCurrent(runtime, userId, s);
    expect(runtime.status(userId, s.id)?.sharing).toBe("active");
    expect(
      runtime.getOwnExecution(userId, s.id)?.execution.exercises[0]
        .substituteExerciseId,
    ).toBe(s.exercises[0].exerciseId);
    s.exercises[0].sets[0].reps = 8;
    saveCurrent(runtime, userId, s);
    s.exercises[0].exerciseId = randomUUID();
    saveCurrent(runtime, userId, s);
    expect(runtime.status(userId, s.id)).toMatchObject({
      sharing: "paused",
      error: "workout-substitution-locked",
    });
    expect(runtime.read(userId, s.id)?.exercises).toEqual(s.exercises);
  });
  it("canonical own substitution supports reset before logging and never relabels prior logged sets", async () => {
    const s = draft();
    s.exercises[0].sets[0].reps = null;
    await runtime.promote(s);
    const plan = runtime.getPlan(userId, s.id)!;
    const planId = plan.exercises[0].planExerciseId;
    const original = s.exercises[0].exerciseId;
    const alternative = randomUUID();
    runtime.applyOwnOperation(userId, s.id, 0, {
      type: "substitute",
      planExerciseId: planId,
      exerciseId: alternative,
    });
    expect(runtime.read(userId, s.id)?.exercises[0]).toMatchObject({
      exerciseId: alternative,
      originalExerciseId: original,
    });
    runtime.applyOwnOperation(userId, s.id, 1, {
      type: "substitute",
      planExerciseId: planId,
      exerciseId: null,
    });
    expect(runtime.read(userId, s.id)?.exercises[0]).toMatchObject({
      exerciseId: original,
      originalExerciseId: null,
    });
    const setId = randomUUID();
    runtime.applyOwnOperation(userId, s.id, 2, {
      type: "upsertSet",
      planExerciseId: planId,
      set: { setId, reps: 8, weightKg: 60, completed: true },
    });
    const before = runtime.read(userId, s.id);
    const execution = runtime.getOwnExecution(userId, s.id);
    expect(() =>
      runtime.applyOwnOperation(userId, s.id, 3, {
        type: "substitute",
        planExerciseId: planId,
        exerciseId: alternative,
      }),
    ).toThrow("substitution-locked");
    expect(runtime.read(userId, s.id)).toEqual(before);
    expect(runtime.getOwnExecution(userId, s.id)).toEqual(execution);
    runtime.applyOwnOperation(userId, s.id, 3, {
      type: "substitute",
      planExerciseId: planId,
      exerciseId: null,
    });
    expect(runtime.getOwnExecution(userId, s.id)).toEqual(execution);
    expect(() =>
      runtime.applyOwnOperation(userId, s.id, 3, {
        type: "substitute",
        planExerciseId: planId,
        exerciseId: "bad",
      }),
    ).toThrow("invalid-operation");
  });
  describe("reviewed result recovery with simulated server and real signatures", () => {
    let api: TogetherRecoveryApi;
    let candidate: TogetherRecoveryCandidate | undefined;
    let accepted: TogetherRecoveryResult | undefined;
    let sign: jest.Mock;
    let uploaded = new Map<string, { hash: string; revision: number }>();
    let requests: { key: string; count: number }[];
    let completions: {
      key: string;
      body: { expectedRevision: number; completedAt: string };
    }[];
    const options = () => ({
      api,
      sign,
      now: () => Date.parse("2026-10-04T10:00:00Z"),
    });
    beforeEach(() => {
      candidate = undefined;
      accepted = undefined;
      uploaded = new Map();
      requests = [];
      completions = [];
      sign = jest.fn(
        async (
          _credential: Signed<Credential>,
          commands: readonly TogetherRecoveryCommand[],
        ) => commands.map((c) => signPayload(c, seed)),
      );
      api = {
        upload: async (key, body) => {
          requests.push({ key, count: body.commands.length });
          candidate ??= {
            status: "stored_for_review",
            sharingActive: false,
            historySaved: false,
            sessionId: body.sessionId,
            executionId: body.executionId,
            revision: 0,
            startedAt: body.startedAt,
            plan: body.plan,
            execution: { exercises: [] },
          };
          const receipts = body.commands.map((envelope) => {
            const command = readOwnerCommand(
              commandFromEnvelope(envelope),
              credential,
            );
            const previous = uploaded.get(command.commandId);
            if (!previous) {
              expect(command.expectedVersion).toBe(candidate!.revision);
              const op = command.operation;
              if (op.type === "rest")
                candidate!.execution.restEndsAt = op.endsAt as string | null;
              else {
                let e = candidate!.execution.exercises.find(
                  (x) => x.planExerciseId === op.planExerciseId,
                );
                if (!e) {
                  e = {
                    planExerciseId: op.planExerciseId as string,
                    skipped: false,
                    sets: [],
                  };
                  candidate!.execution.exercises.push(e);
                }
                if (op.type === "skip") e.skipped = op.skipped as boolean;
                else if (op.type === "substitute")
                  e.substituteExerciseId = op.exerciseId as string | null;
                else if (op.type === "removeSet")
                  e.sets = e.sets.filter((x) => x.setId !== op.setId);
                else if (op.type === "upsertSet") {
                  const set =
                    op.set as TogetherRecoveryExecution["exercises"][number]["sets"][number];
                  e.sets = e.sets.filter((x) => x.setId !== set.setId);
                  e.sets.push(set);
                  e.everAcknowledged = true;
                }
              }
              candidate!.revision++;
              uploaded.set(command.commandId, {
                hash: requestHash(command),
                revision: candidate!.revision,
              });
            }
            const stored = uploaded.get(command.commandId)!;
            return {
              commandId: command.commandId,
              commandHash: stored.hash,
              revision: stored.revision,
              status: "stored_for_review" as const,
            };
          });
          return ok(JSON.parse(JSON.stringify({ ...candidate, receipts })));
        },
        get: async () => {
          if (!candidate)
            return fail({ kind: "api", code: "not_found", message: "missing" });
          return ok(
            JSON.parse(
              JSON.stringify({
                ...candidate,
                ...(accepted?.reviewedRevision === candidate.revision
                  ? { ...accepted, historySaved: accepted.status === "saved" }
                  : {}),
              }),
            ),
          );
        },
        complete: async (_id, key, body) => {
          completions.push({ key, body });
          if (!candidate || candidate.revision !== body.expectedRevision)
            return fail({
              kind: "api",
              code: "unknown",
              togetherCode: "VERSION_CONFLICT",
              message: "changed",
            });
          accepted = {
            status: candidate.execution.exercises.some((e) =>
              e.sets.some((s) => s.completed),
            )
              ? "saved"
              : "finished_empty",
            historyId: candidate.execution.exercises.some((e) =>
              e.sets.some((s) => s.completed),
            )
              ? (accepted?.historyId ?? randomUUID())
              : null,
            reviewedRevision: body.expectedRevision,
            effectsPending: true,
            sharingActive: false,
          };
          return ok(accepted);
        },
      };
      runtime = new TogetherWorkoutCheckpoint(
        adapter,
        () => account,
        () => authority,
        randomUUID,
        options(),
      );
    });
    it("uploads genuine own commands, requires review, explicitly finishes stable history and retires active checkpoint", async () => {
      const s = draft();
      s.locationName = "Gym";
      await runtime.promote(s);
      await expect(
        runtime.finish(userId, s.id, 1, "unreviewed"),
      ).rejects.toThrow("recovery-review-required");
      const review = await runtime.review(userId, s.id);
      expect(review).toMatchObject({
        status: "stored_for_review",
        historySaved: false,
        revision: 1,
        omissions: [
          "Workout and exercise notes stay on this device.",
          "Workout location details stay on this device.",
        ],
      });
      expect(runtime.status(userId, s.id)?.recovery).toBe("review");
      expect(runtime.getReview(userId, s.id)).toEqual(review);
      const saved = await runtime.finish(
        userId,
        s.id,
        review.revision,
        review.snapshotToken,
      );
      expect(saved).toMatchObject({
        status: "saved",
        historySaved: true,
        historyId: expect.any(String),
      });
      expect(runtime.getActive(userId)).toBeNull();
      expect(runtime.read(userId, s.id)).toMatchObject({
        status: "completed",
        notes: s.notes,
      });
      expect(runtime.status(userId, s.id)?.recovery).toBe("saved");
      expect(
        await runtime.finish(
          userId,
          s.id,
          review.revision,
          review.snapshotToken,
        ),
      ).toEqual(saved);
      expect(await runtime.review(userId, s.id)).toEqual(saved);
      expect(completions).toHaveLength(1);
      expect(() => saveCurrent(runtime, userId, s)).toThrow("workout-finished");
    });
    it("keeps blank and partial sets, explicitly finishes empty without fabricated weight/reps", async () => {
      const s = draft();
      s.exercises[0].sets[0].reps = null;
      await runtime.promote(s);
      const review = await runtime.review(userId, s.id);
      expect(review.execution.exercises).toEqual([]);
      expect(review.omissions).toContain(
        "Unfinished sets stay on this device and are not included in this result.",
      );
      const saved = await runtime.finish(
        userId,
        s.id,
        review.revision,
        review.snapshotToken,
      );
      expect(saved).toMatchObject({
        status: "finished_empty",
        historyId: null,
        historySaved: false,
      });
      expect(runtime.getActive(userId)).toBeNull();
      expect(runtime.read(userId, s.id)?.exercises).toEqual(s.exercises);
    });
    it("uploads over 100 original-key signed offline intents in bounded batches", async () => {
      const s = draft();
      await runtime.promote(s);
      authority = undefined;
      for (let reps = 9; reps < 214; reps++) {
        s.exercises[0].sets[0].reps = reps;
        saveCurrent(runtime, userId, s);
      }
      runtime = new TogetherWorkoutCheckpoint(
        adapter,
        () => account,
        () => authority,
        randomUUID,
        options(),
      );
      const review = await runtime.review(userId, s.id);
      expect(requests.map((r) => r.count)).toEqual([100, 100, 6]);
      expect(sign.mock.calls.map((c) => c[1].length)).toEqual([100, 100, 5]);
      expect(review.revision).toBe(206);
      expect(review.execution.exercises[0].sets[0].reps).toBe(213);
      expect(sign.mock.calls[0][0]).toEqual(credential);
      expect(runtime.status(userId, s.id)?.sharing).toBe("local-only");
    });
    it("reuses a durable upload key after the server stores an ambiguous response", async () => {
      const s = draft();
      await runtime.promote(s);
      const upload = api.upload;
      let first = true;
      api.upload = async (key, body) => {
        const result = await upload(key, body);
        if (first) {
          first = false;
          throw new Error("lost response");
        }
        return result;
      };
      await expect(runtime.review(userId, s.id)).rejects.toThrow(
        "lost response",
      );
      runtime = new TogetherWorkoutCheckpoint(
        adapter,
        () => account,
        () => authority,
        randomUUID,
        options(),
      );
      const review = await runtime.review(userId, s.id);
      expect(requests[0].key).toBe(requests[1].key);
      expect(review.revision).toBe(1);
    });
    it("retries the exact complete key/time after ambiguous success and a runtime restart", async () => {
      const s = draft();
      await runtime.promote(s);
      const review = await runtime.review(userId, s.id),
        complete = api.complete;
      let first = true;
      api.complete = async (...args) => {
        const result = await complete(...args);
        if (first) {
          first = false;
          throw new Error("lost completion");
        }
        return result;
      };
      await expect(
        runtime.finish(userId, s.id, review.revision, review.snapshotToken),
      ).rejects.toThrow("lost completion");
      expect(runtime.getActive(userId)).not.toBeNull();
      runtime = new TogetherWorkoutCheckpoint(
        adapter,
        () => account,
        () => authority,
        randomUUID,
        options(),
      );
      const saved = await runtime.review(userId, s.id);
      expect(saved.status).toBe("saved");
      expect(completions[0]).toEqual(completions[1]);
    });
    it("rejects local note edits at the same server revision until a fresh review", async () => {
      const s = draft();
      await runtime.promote(s);
      const review = await runtime.review(userId, s.id);
      s.notes = "Edited after review";
      saveCurrent(runtime, userId, s);
      expect(runtime.getReview(userId, s.id)).toBeNull();
      await expect(
        runtime.finish(userId, s.id, review.revision, review.snapshotToken),
      ).rejects.toThrow("workout-review-stale");
      const next = await runtime.review(userId, s.id);
      expect(next.revision).toBe(review.revision);
      expect(next.snapshotToken).not.toBe(review.snapshotToken);
      await runtime.finish(userId, s.id, next.revision, next.snapshotToken);
      expect(runtime.read(userId, s.id)?.notes).toBe(s.notes);
    });
    it("does not retire edits arriving while completion is in flight", async () => {
      const s = draft();
      await runtime.promote(s);
      const review = await runtime.review(userId, s.id);
      const complete = api.complete;
      api.complete = async (...args) => {
        const result = await complete(...args);
        s.exercises[0].sets[0].reps = 15;
        saveCurrent(runtime, userId, s);
        return result;
      };
      await expect(
        runtime.finish(userId, s.id, review.revision, review.snapshotToken),
      ).rejects.toThrow("workout-review-stale");
      expect(runtime.getActive(userId)?.exercises[0].sets[0].reps).toBe(15);
      api.complete = complete;
      const next = await runtime.review(userId, s.id);
      expect(next.status).toBe("stored_for_review");
      const saved = await runtime.finish(
        userId,
        s.id,
        next.revision,
        next.snapshotToken,
      );
      expect(saved.historyId).toBe(accepted?.historyId);
    });
    it.each(["upload", "get", "sign"])(
      "refuses a snapshot changed during %s without overwriting personal work",
      async (where) => {
        const s = draft();
        await runtime.promote(s);
        const change = () => {
          s.notes = "new";
          saveCurrent(runtime, userId, s);
        };
        if (where === "sign") {
          authority = undefined;
          s.exercises[0].sets[0].reps = 12;
          saveCurrent(runtime, userId, s);
          sign.mockImplementation(async (_c, commands) => {
            change();
            return commands.map((c: TogetherRecoveryCommand) =>
              signPayload(c, seed),
            );
          });
        } else if (where === "upload") {
          const original = api.upload;
          api.upload = async (...args) => {
            const result = await original(...args);
            change();
            return result;
          };
        } else {
          const original = api.get;
          api.get = async (...args) => {
            const result = await original(...args);
            change();
            return result;
          };
        }
        await expect(runtime.review(userId, s.id)).rejects.toThrow(
          "workout-review-stale",
        );
        expect(runtime.read(userId, s.id)?.notes).toBe("new");
        expect(runtime.getReview(userId, s.id)).toBeNull();
      },
    );
    it("rejects responses arriving after account changes including A-B-A", async () => {
      await runtime.promote(draft());
      const original = api.get;
      api.get = async (...args) => {
        const value = await original(...args);
        account = randomUUID();
        runtime.changed();
        account = userId;
        runtime.changed();
        return value;
      };
      await expect(runtime.review(userId, draft().id)).rejects.toThrow(
        "workout-account",
      );
      expect(runtime.getReview(userId, draft().id)).toBeNull();
    });
    it("explicitly omits unsupported edited fields while retaining the full personal snapshot", async () => {
      const s = draft();
      await runtime.promote(s);
      s.exercises[0].sets[0].rpe = 7;
      saveCurrent(runtime, userId, s);
      const review = await runtime.review(userId, s.id);
      expect(review.retainedLocalChanges).toBe(true);
      expect(review.omissions.join(" ")).toContain("not included");
      expect(review.execution.exercises[0].sets[0]).not.toHaveProperty("rpe");
      expect(requests).toHaveLength(1);
      expect(runtime.read(userId, s.id)?.exercises[0].sets[0].rpe).toBe(7);
    });
    it("rejects an unrelated candidate, forged receipts and refused completion", async () => {
      await runtime.promote(draft());
      const get = api.get;
      api.get = async (...args) => {
        await get(...args);
        return ok({ ...candidate!, executionId: randomUUID() });
      };
      await expect(runtime.review(userId, draft().id)).rejects.toThrow(
        "recovery-invalid-response",
      );
      api.get = get;
      const review = await runtime.review(userId, draft().id);
      api.complete = async () =>
        fail({
          kind: "api",
          code: "unknown",
          message: "conflict",
          togetherCode: "VERSION_CONFLICT",
        });
      await expect(
        runtime.finish(
          userId,
          draft().id,
          review.revision,
          review.snapshotToken,
        ),
      ).rejects.toThrow("VERSION_CONFLICT");
      expect(runtime.getActive(userId)).not.toBeNull();
    });
    it("reviews multiple own sets with independent substitution/rest/skip controls", async () => {
      const s = draft();
      s.exercises[0].sets[0].reps = null;
      await runtime.promote(s);
      s.exercises[0].originalExerciseId = s.exercises[0].exerciseId;
      s.exercises[0].exerciseId = randomUUID();
      s.exercises[0].skipped = true;
      s.restEndsAt = "2026-10-05T10:00:00.000Z";
      saveCurrent(runtime, userId, s);
      s.exercises[0].sets[0].reps = 10;
      s.exercises[0].sets.push({ ...s.exercises[0].sets[0], id: "second" });
      saveCurrent(runtime, userId, s);
      const review = await runtime.review(userId, s.id);
      expect(review.execution.exercises[0]).toMatchObject({
        skipped: true,
        substituteExerciseId: s.exercises[0].exerciseId,
      });
      expect(review.execution.exercises[0].sets).toHaveLength(2);
    });
    it("rejects forged stored receipts and mismatched completion revision", async () => {
      await runtime.promote(draft());
      const upload = api.upload;
      api.upload = async (...args) => {
        const value = await upload(...args);
        if (value.ok) value.value.receipts[0].commandHash = "0".repeat(64);
        return value;
      };
      await expect(runtime.review(userId, draft().id)).rejects.toThrow(
        "recovery-invalid-response",
      );
      api.upload = upload;
      const reviewed = await runtime.review(userId, draft().id);
      api.complete = async () =>
        ok({
          status: "saved",
          historyId: randomUUID(),
          reviewedRevision: reviewed.revision + 1,
          effectsPending: false,
          sharingActive: false,
        });
      await expect(
        runtime.finish(
          userId,
          draft().id,
          reviewed.revision,
          reviewed.snapshotToken,
        ),
      ).rejects.toThrow("recovery-invalid-response");
    });
    it("retires a server-confirmed previously accepted exact revision without another completion", async () => {
      await runtime.promote(draft());
      const review = await runtime.review(userId, draft().id);
      await api.complete(authority!.executionId, randomUUID(), {
        expectedRevision: review.revision,
        completedAt: "2026-10-04T10:00:00Z",
      });
      runtime = new TogetherWorkoutCheckpoint(
        adapter,
        () => account,
        () => authority,
        randomUUID,
        options(),
      );
      const restored = await runtime.review(userId, draft().id);
      expect(restored.status).toBe("saved");
      expect(runtime.getActive(userId)).toBeNull();
      expect(completions).toHaveLength(1);
      expect(runtime.read(userId, draft().id)?.completedAt).toBeNull();
    });
    it("requires exact candidate values even if revision and identity match", async () => {
      await runtime.promote(draft());
      const get = api.get;
      api.get = async (...args) => {
        const result = await get(...args);
        if (result.ok) result.value.execution.exercises[0].sets[0].reps = 999;
        return result;
      };
      await expect(runtime.review(userId, draft().id)).rejects.toThrow(
        "recovery-invalid-response",
      );
    });
    it("rejects empty or wrong-key signer responses without losing own snapshot", async () => {
      const s = draft();
      await runtime.promote(s);
      authority = undefined;
      s.exercises[0].sets[0].reps = 12;
      saveCurrent(runtime, userId, s);
      sign.mockResolvedValue([]);
      await expect(runtime.review(userId, s.id)).rejects.toThrow(
        "recovery-invalid-signature",
      );
      sign.mockImplementation(async (_c, commands) =>
        commands.map((c: TogetherRecoveryCommand) =>
          signPayload({ ...c, commandId: randomUUID() }, seed),
        ),
      );
      await expect(runtime.review(userId, s.id)).rejects.toThrow(
        "recovery-invalid-signature",
      );
      expect(runtime.read(userId, s.id)?.exercises[0].sets[0].reps).toBe(12);
    });
    it("reports unavailable configuration, missing checkpoint, concurrent work and invalid completion clock", async () => {
      const absent = new TogetherWorkoutCheckpoint(
        adapter,
        () => account,
        () => authority,
        randomUUID,
      );
      await expect(absent.review(userId, "missing")).rejects.toThrow(
        "recovery-unavailable",
      );
      await expect(runtime.review(userId, "missing")).rejects.toThrow(
        "workout-not-promoted",
      );
      await runtime.promote(draft());
      let resolve!: (
        value: Awaited<ReturnType<TogetherRecoveryApi["get"]>>,
      ) => void;
      const get = api.get;
      api.get = () =>
        new Promise((r) => {
          resolve = r;
        });
      const first = runtime.review(userId, draft().id);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await expect(runtime.review(userId, draft().id)).rejects.toThrow(
        "recovery-busy",
      );
      expect(runtime.status(userId, draft().id)?.recovery).toBe("uploading");
      resolve(await get(authority!.executionId));
      const review = await first;
      runtime = new TogetherWorkoutCheckpoint(
        adapter,
        () => account,
        () => authority,
        randomUUID,
        { ...options(), now: () => 1 },
      );
      await expect(
        runtime.finish(
          userId,
          draft().id,
          review.revision,
          review.snapshotToken,
        ),
      ).rejects.toThrow("recovery-invalid-time");
    });
    it.each(["add", "substitute"])(
      "reviews original signed work after unsupported %s and retains every later local change after acceptance",
      async (change) => {
        const s = draft();
        await runtime.promote(s);
        const originalPlan = runtime.getPlan(userId, s.id)!;
        const originalExecution = runtime.getOwnExecution(
          userId,
          s.id,
        )!.execution;
        if (change === "add")
          s.exercises.push({
            ...s.exercises[0],
            id: "local-extra",
            exerciseId: randomUUID(),
            exerciseName: "New private exercise",
            sortOrder: 1,
            sets: s.exercises[0].sets.map((set) => ({
              ...set,
              id: "local-extra-set",
              sessionExerciseId: "local-extra",
              reps: 12,
            })),
          });
        else {
          s.exercises[0].originalExerciseId = s.exercises[0].exerciseId;
          s.exercises[0].exerciseId = randomUUID();
          s.exercises[0].exerciseName = "Private substitute";
          s.exercises[0].sets[0].reps = 12;
        }
        saveCurrent(runtime, userId, s);
        expect(runtime.status(userId, s.id)?.sharing).toBe("paused");
        const changed = runtime.read(userId, s.id)!;
        const review = await runtime.review(userId, s.id);
        expect(review.retainedLocalChanges).toBe(true);
        expect(review.omissions.join(" ")).toContain("original supported plan");
        expect(review.plan).toEqual(originalPlan);
        expect(review.execution.exercises[0].sets).toEqual(
          originalExecution.exercises[0].sets,
        );
        const saved = await runtime.finish(
          userId,
          s.id,
          review.revision,
          review.snapshotToken,
        );
        expect(saved.status).toBe("saved");
        expect(saved.retainedLocalChanges).toBe(true);
        expect(runtime.getActive(userId)).toEqual(changed);
        expect(runtime.read(userId, s.id)?.status).toBe("in_progress");
        const continued = runtime.read(userId, s.id)!;
        continued.notes = "Continue privately without losing the changed work";
        saveCurrent(runtime, userId, continued);
        expect(runtime.getActive(userId)?.notes).toBe(continued.notes);
        const again = await runtime.review(userId, s.id);
        expect(again.retainedLocalChanges).toBe(true);
        expect(again.historyId).toBe(saved.historyId);
        expect(runtime.getActive(userId)?.exercises).toEqual(changed.exercises);
        expect(
          (
            await runtime.finish(
              userId,
              s.id,
              again.revision,
              again.snapshotToken,
            )
          ).historyId,
        ).toBe(saved.historyId);
      },
    );
  });
});
