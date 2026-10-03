/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
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
} from "../security/identity";
import { readOwnerCommand } from "../localCommand";
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
    runtime.save(userId, source);
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
  it("edits, partial values, removed sets and newly completed sets produce ordered immutable operations", async () => {
    const s = draft();
    await runtime.promote(s);
    s.exercises[0].sets[0].reps = 9;
    runtime.save(userId, s);
    s.exercises[0].sets[0].weightKg = null;
    runtime.save(userId, s);
    runtime.save(userId, s);
    s.exercises[0].sets.push({
      ...s.exercises[0].sets[0],
      id: "another",
      weightKg: 30,
      reps: 10,
    });
    runtime.save(userId, s);
    s.exercises[0].sets.splice(1, 1);
    runtime.save(userId, s);
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
    expect(() => runtime.save(userId, s)).toThrow("disk full");
    expect(entries()).toHaveLength(1);
    expect(runtime.read(userId, s.id)!.exercises[0].sets[0].reps).toBe(8);
  });
  it("retains unsigned durable intents after authority leaves and isolates account access", async () => {
    const s = draft();
    await runtime.promote(s);
    authority = undefined;
    s.exercises[0].sets[0].reps = 10;
    runtime.save(userId, s);
    expect(runtime.status(userId, s.id)).toMatchObject({
      sharing: "local-only",
      pendingCount: 2,
    });
    account = randomUUID();
    expect(runtime.read(userId, s.id)).toBeNull();
    expect(runtime.status(userId, s.id)).toBeNull();
    expect(() => runtime.save(userId, s)).toThrow("workout-account");
    await expect(runtime.promote(s)).rejects.toThrow("workout-account");
    account = userId;
    await expect(runtime.promote(s)).rejects.toThrow("workout-not-admitted");
    expect(() => runtime.save(userId, { ...s, userId: randomUUID() })).toThrow(
      "workout-account",
    );
    expect(() => runtime.save(userId, { ...s, id: "unknown" })).toThrow(
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
      runtime.save(userId, s);
      expect(runtime.status(userId, s.id)).toMatchObject({
        sharing: "paused",
        error: "workout-plan-changed",
      });
      expect(runtime.read(userId, s.id)).toMatchObject(s);
      expect(entries()).toHaveLength(1);
      runtime.save(userId, draft());
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
      runtime.save(userId, s);
      if (name === "empty sets") {
        expect(runtime.status(userId, s.id)?.sharing).toBe("active");
        expect(entries()).toHaveLength(2);
      } else {
        expect(runtime.status(userId, s.id)).toMatchObject({
          sharing: "paused",
          error: "workout-unsupported",
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
    runtime.save(userId, { ...original, status: "cancelled" });
    expect(runtime.getActive(userId)).toBeNull();
  });
  it("signs missing earlier intents before new versions when the same authority returns", async () => {
    const s = draft();
    await runtime.promote(s);
    const original = authority!;
    authority = undefined;
    s.exercises[0].sets[0].reps = 12;
    runtime.save(userId, s);
    authority = original;
    s.exercises[0].sets[0].reps = 13;
    runtime.save(userId, s);
    const rows = entries();
    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) => JSON.parse(row.payload).payload.expectedVersion),
    ).toEqual([0, 1, 2]);
    expect(runtime.status(userId, s.id)).toMatchObject({
      sharing: "active",
      pendingCount: 3,
    });
    runtime.save(userId, s);
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
      runtime.save(userId, s);
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
});
