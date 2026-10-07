/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { TogetherCloudController } from "../cloudSession";
import type { TogetherCloudApi } from "../../../domain/ports/togetherCloud.port";
import type { WorkoutSession } from "../../../domain/models/session";
import type { TogetherJournalDatabase } from "../../storage/togetherJournal";
import { fail } from "../../../shared/errors/result";
const userId = randomUUID(),
  exerciseId = randomUUID();
function draft(): WorkoutSession {
  return {
    id: "local-own",
    userId,
    name: "Squat",
    status: "in_progress",
    startedAt: "2026-10-04T09:00:00.000Z",
    completedAt: null,
    notes: "Keep notes",
    workoutId: null,
    exercises: [
      {
        id: "local-exercise",
        sessionId: "local-own",
        exerciseId,
        exerciseName: "Squat",
        category: "strength",
        sortOrder: 0,
        supersetGroup: null,
        isSubstituted: false,
        originalExerciseId: null,
        notes: null,
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
function adapter(db: DatabaseSync): TogetherJournalDatabase {
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, p) => db.prepare(sql).run(...p),
    getFirstSync: <T>(sql: string, p: (string | number | null)[]) =>
      (db.prepare(sql).get(...p) as T) ?? null,
    getAllSync: <T>(sql: string, p: (string | number | null)[]) =>
      db.prepare(sql).all(...p) as T[],
    withTransactionSync: (fn) => {
      db.exec("BEGIN");
      try {
        fn();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

describe("terminal initial cloud admission recovery", () => {
  let db: DatabaseSync;
  let controller: TogetherCloudController;
  let api: TogetherCloudApi;
  const reject = (togetherCode?: string) =>
    fail({
      kind: "api" as const,
      code: "server" as const,
      message: "Rejected",
      togetherCode,
    });
  const restore = () => {
    controller?.dispose();
    controller = new TogetherCloudController({
      api,
      db: adapter(db),
      randomUUID,
    });
    controller.setAccount(userId);
  };
  const start = (method: "create" | "join") =>
    method === "create"
      ? controller.hostWorkout(draft())
      : controller.join(
          {
            sessionId: randomUUID(),
          },
          draft(),
        );
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    api = { create: jest.fn(), join: jest.fn() } as unknown as TogetherCloudApi;
    controller = new TogetherCloudController({
      api,
      db: adapter(db),
      randomUUID,
    });
    controller.setAccount(userId);
  });
  afterEach(() => {
    controller.dispose();
    db.close();
  });
  it.each(["create", "join"] as const)(
    "retains and detaches the full personal checkpoint after a conclusively rejected %s, including restart",
    async (method) => {
      jest
        .mocked(api[method])
        .mockResolvedValue(
          reject(method === "join" ? "SESSION_FULL" : "NOT_FOUND"),
        );
      await expect(start(method)).rejects.toThrow();
      expect(controller.getSnapshot()).toMatchObject({
        canDetachDraft: true,
        pendingCount: 0,
        phase: "unavailable",
      });
      restore();
      expect(controller.getSnapshot().canDetachDraft).toBe(true);
      const save = jest.fn();
      controller.detachDraft(userId, save);
      expect(save).toHaveBeenCalledWith(draft());
      expect(controller.readDraft(userId)).toBeNull();
      await controller.retry();
      expect(api[method]).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["create", "join"] as const)(
    "preserves %s request identity after ambiguous transport failure and later rejection",
    async (method) => {
      jest
        .mocked(api[method])
        .mockResolvedValueOnce(
          fail({ kind: "api", code: "timeout", message: "Lost response" }),
        )
        .mockResolvedValue(reject("NOT_FOUND"));
      await expect(start(method)).rejects.toThrow("timeout");
      const firstArgs = jest.mocked(api[method]).mock.calls[0];
      restore();
      await expect(controller.retry()).rejects.toThrow("NOT_FOUND");
      expect(jest.mocked(api[method]).mock.calls[1]).toEqual(firstArgs);
      expect(controller.getSnapshot()).toMatchObject({
        canDetachDraft: false,
        pendingCount: 1,
      });
      expect(() => controller.detachDraft(userId, jest.fn())).toThrow(
        "cloud-cannot-detach",
      );
      expect(controller.readDraft(userId)?.together).toBeDefined();
    },
  );
  it.each([401, 402, 403, 404, 422])(
    "allows explicit personal recovery after first-attempt HTTP %s rejection",
    async (status) => {
      jest.mocked(api.create).mockResolvedValue(
        fail({
          kind: "api",
          code: "server",
          status,
          message: "Rejected without Together envelope",
        }),
      );
      await expect(start("create")).rejects.toThrow("server");
      expect(controller.getSnapshot().canDetachDraft).toBe(true);
      const save = jest.fn();
      controller.detachDraft(userId, save);
      expect(save).toHaveBeenCalledWith(draft());
    },
  );
  it.each([400, 408, 429, 500, 502, 503])(
    "retains admission identity for ambiguous HTTP %s",
    async (status) => {
      jest.mocked(api.create).mockResolvedValue(
        fail({
          kind: "api",
          code: "server",
          status,
          message: "Unknown failure",
        }),
      );
      await expect(start("create")).rejects.toThrow("server");
      expect(controller.getSnapshot().canDetachDraft).toBe(false);
      expect(() => controller.detachDraft(userId, jest.fn())).toThrow(
        "cloud-cannot-detach",
      );
    },
  );
  it("does not treat a later HTTP authorization failure as proof the timed-out creation never committed", async () => {
    jest
      .mocked(api.create)
      .mockResolvedValueOnce(
        fail({ kind: "api", code: "timeout", message: "Unknown result" }),
      )
      .mockResolvedValue(
        fail({
          kind: "api",
          code: "unauthorized",
          status: 401,
          message: "Expired",
        }),
      );
    await expect(start("create")).rejects.toThrow("timeout");
    await expect(controller.retry()).rejects.toThrow("unauthorized");
    expect(controller.getSnapshot().canDetachDraft).toBe(false);
    expect(jest.mocked(api.create).mock.calls[0]).toEqual(
      jest.mocked(api.create).mock.calls[1],
    );
  });
  it("preserves unknown server responses for safe idempotent retry", async () => {
    jest.mocked(api.join).mockResolvedValue(reject());
    await expect(start("join")).rejects.toThrow("server");
    expect(controller.getSnapshot()).toMatchObject({
      canDetachDraft: false,
      pendingCount: 1,
    });
  });
  it("rolls back a failed personal checkpoint handoff so it can be retried", async () => {
    jest.mocked(api.join).mockResolvedValue(reject("NOT_FOUND"));
    await expect(start("join")).rejects.toThrow("NOT_FOUND");
    expect(() =>
      controller.detachDraft(userId, () => {
        throw new Error("disk full");
      }),
    ).toThrow("disk full");
    expect(controller.readDraft(userId)?.together).toBeDefined();
    const save = jest.fn();
    controller.detachDraft(userId, save);
    expect(save).toHaveBeenCalledWith(draft());
  });
  it("keeps legacy attempted outboxes conservative after a definitive-looking rejection", async () => {
    jest
      .mocked(api.join)
      .mockResolvedValueOnce(
        fail({ kind: "api", code: "network", message: "lost" }),
      )
      .mockResolvedValue(reject("SESSION_FULL"));
    await expect(start("join")).rejects.toThrow("network");
    const row = db
      .prepare(
        "SELECT payload FROM together_cloud_workout WHERE account_id = ?",
      )
      .get(userId) as { payload: string };
    const stored = JSON.parse(row.payload);
    delete stored.pending[0].admissionAttempted;
    db.prepare(
      "UPDATE together_cloud_workout SET payload = ? WHERE account_id = ?",
    ).run(JSON.stringify(stored), userId);
    restore();
    await expect(controller.retry()).rejects.toThrow("SESSION_FULL");
    expect(controller.getSnapshot()).toMatchObject({
      canDetachDraft: false,
      pendingCount: 1,
    });
  });
  it.each(["create", "join"] as const)(
    "keeps edits made during and after a terminal %s rejection recoverable",
    async (method) => {
      let resolve!: (value: ReturnType<typeof reject>) => void;
      jest.mocked(api[method]).mockImplementation(
        () =>
          new Promise<ReturnType<typeof reject>>((done) => {
            resolve = done;
          }),
      );
      const admission = start(method);
      const updated = draft();
      updated.exercises[0].sets[0].weightKg = 55;
      updated.notes = "Written during admission";
      controller.saveDraft(userId, updated);
      expect(controller.getSnapshot().pendingCount).toBe(
        method === "create" ? 2 : 1,
      );
      resolve(reject("NOT_FOUND"));
      await expect(admission).rejects.toThrow("NOT_FOUND");
      expect(controller.getSnapshot()).toMatchObject({
        canDetachDraft: true,
        pendingCount: 0,
      });
      updated.exercises[0].sets[0].reps = 12;
      updated.notes = "Written after rejection";
      controller.saveDraft(userId, updated);
      expect(controller.getSnapshot()).toMatchObject({
        canDetachDraft: true,
        pendingCount: 0,
      });
      restore();
      const save = jest.fn();
      controller.detachDraft(userId, save);
      expect(save).toHaveBeenCalledWith(updated);
      expect(api[method]).toHaveBeenCalledTimes(1);
    },
  );
});
