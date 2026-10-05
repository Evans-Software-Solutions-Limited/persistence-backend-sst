/** @jest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { TogetherCloudController } from "../cloudSession";
import { promoteCloudDraft } from "../cloudDraft";
import type {
  TogetherCloudApi,
  CloudSnapshot,
  CloudCommand,
} from "../../../domain/ports/togetherCloud.port";
import type { WorkoutSession } from "../../../domain/models/session";
import type { TogetherJournalDatabase } from "../../storage/togetherJournal";
import { ok, fail } from "../../../shared/errors/result";
const userId = randomUUID(),
  other = randomUUID(),
  exerciseId = randomUUID();
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
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
function snapshot(): CloudSnapshot {
  const { draft: d } = promoteCloudDraft(draft(), randomUUID);
  return {
    sessionId: randomUUID(),
    state: "active",
    sharingActive: true,
    continuation: null,
    hostId: userId,
    revision: 1,
    planVersion: 1,
    plan: d.plan,
    participants: [
      {
        userId,
        status: "active",
        ownRevision: 0,
        delegationGeneration: 0,
        allowPartnerLogging: false,
        execution: d.ownExecution,
        numbersAvailable: true,
        previousValuesAvailable: true,
        numbersConsent: { version: 0, recipientIds: [] },
        previousConsent: { version: 0, recipientIds: [] },
        exerciseCatalog: {
          [exerciseId]: {
            name: "Squat",
            category: "strength",
            primaryMuscles: [],
          },
        },
      },
    ],
    completion: {
      status: "active",
      historyId: null,
      ownRevision: 0,
      recoveryMayBePending: false,
    },
  };
}
describe("cloud authoritative personal checkpoint", () => {
  let directory: string | undefined;
  let db: DatabaseSync,
    api: TogetherCloudApi,
    controller: TogetherCloudController,
    server: CloudSnapshot;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    server = snapshot();
    api = {
      create: jest.fn(async (_key, d) => {
        server.plan = copy(d.plan);
        server.participants[0].execution = copy(d.ownExecution);
        return ok({
          sessionId: server.sessionId,
          revision: server.revision,
          snapshot: copy(server),
        });
      }),
      snapshot: jest.fn(async () => ok(copy(server))),
      requests: jest.fn(async () => ok({ data: [], nextCursor: null })),
      command: jest.fn(async (_id, _key, c: CloudCommand) => {
        const p = server.participants[0];
        if (c.expectedVersion !== p.ownRevision)
          return fail({
            kind: "api",
            code: "conflict",
            message: "conflict",
            togetherCode: "VERSION_CONFLICT",
          });
        const op = c.operation as any;
        const e = p.execution!.exercises.find(
          (e) => e.planExerciseId === op.planExerciseId,
        );
        if (op.type === "upsertSet") {
          const i = e!.sets.findIndex((s) => s.setId === op.set.setId);
          if (i >= 0) e!.sets[i] = op.set;
          else e!.sets.push(op.set);
        }
        if (op.type === "removeSet")
          e!.sets = e!.sets.filter((s) => s.setId !== op.setId);
        p.ownRevision++;
        server.revision++;
        return ok({
          commandId: c.commandId,
          revision: server.revision,
          event: { newVersion: p.ownRevision },
        });
      }),
      finish: jest.fn(async () => {
        server.participants[0].status = "saved";
        server.completion.status = "saved";
        return ok({ status: "saved", historyId: randomUUID() });
      }),
      join: jest.fn(async () =>
        ok({
          requestId: randomUUID(),
          sessionId: server.sessionId,
          status: "approved",
        }),
      ),
      joinStatus: jest.fn(async () =>
        ok({
          requestId: randomUUID(),
          sessionId: server.sessionId,
          status: "approved",
        }),
      ),
      review: jest.fn(async (_id, _key, body) => {
        server.participants[0].execution = copy(body.execution);
        server.participants[0].status = "saved";
        return ok({ status: "saved", historyId: randomUUID() });
      }),
    } as unknown as TogetherCloudApi;
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
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });
  it("preserves prelogged complete personal snapshot and stable canonical IDs through partial/remove and finish", async () => {
    await controller.hostWorkout(draft());
    expect(controller.readDraft(userId)?.notes).toBe("Keep notes");
    const first = copy(server.participants[0].execution);
    controller.setActive(false);
    const edit = controller.readDraft(userId)!;
    edit.exercises[0].sets[0].reps = null;
    controller.saveDraft(userId, edit);
    expect(controller.readDraft(userId)?.exercises[0].sets[0].weightKg).toBe(
      25,
    );
    controller.setActive(true);
    await controller.resume(server.sessionId);
    expect(server.participants[0].execution!.exercises[0].sets).toEqual([]);
    const restored = controller.readDraft(userId)!;
    restored.exercises[0].sets[0].reps = 9;
    controller.saveDraft(userId, restored);
    await controller.retry();
    expect(server.participants[0].execution!.exercises[0].sets[0].setId).toBe(
      first!.exercises[0].sets[0].setId,
    );
    await controller.finish(controller.reviewToken());
    expect(controller.readDraft(userId)?.status).toBe("completed");
  });
  it("retains an exact outbox key after ambiguous delivery and account switch, and retries without duplicate sets", async () => {
    const original = api.create;
    let ambiguous = true;
    api.create = jest.fn(async (...args) => {
      const result = await original(...args);
      if (ambiguous) {
        ambiguous = false;
        return fail({
          kind: "api" as const,
          code: "network" as const,
          message: "lost response",
        });
      }
      return result;
    });
    await expect(controller.hostWorkout(draft())).rejects.toThrow("network");
    expect(controller.readDraft(userId)?.together?.transport).toBe("cloud");
    controller.setAccount(other);
    expect(controller.readDraft(userId)).toBeNull();
    controller.setAccount(userId);
    await controller.retry();
    const calls = (api.create as jest.Mock).mock.calls;
    expect(calls[0]).toEqual(calls[1]);
    expect(server.participants[0].execution!.exercises[0].sets).toHaveLength(1);
  });
  it("rejects stale review after a local edit and keeps unsupported full edits", async () => {
    await controller.hostWorkout(draft());
    const review = await controller.prepareReview();
    controller.setActive(false);
    const local = controller.readDraft(userId)!;
    local.exercises[0].sets[0].rpe = 8;
    controller.saveDraft(userId, local);
    controller.setActive(true);
    await controller.refresh();
    await expect(controller.finish(review.token)).rejects.toThrow(
      "cloud-review-stale",
    );
    expect(controller.readDraft(userId)?.exercises[0].sets[0].rpe).toBe(8);
    expect((await controller.prepareReview()).retainedLocalChanges).toBe(true);
    expect(api.finish).not.toHaveBeenCalled();
  });
  it("rejects unsupported promotion before mutation and different unfinished workout", async () => {
    const bad = draft();
    bad.exercises[0].sets[0].durationSeconds = 10;
    await expect(controller.hostWorkout(bad)).rejects.toThrow(
      "cloud-workout-unsupported",
    );
    expect(controller.readDraft(userId)).toBeNull();
    await controller.hostWorkout(draft());
    await expect(
      controller.hostWorkout({ ...draft(), id: "another" }),
    ).rejects.toThrow();
  });
  it("does not publish late responses into another account", async () => {
    let resolve!: (x: any) => void;
    api.create = jest.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = controller.hostWorkout(draft());
    controller.setAccount(other);
    resolve(ok({ sessionId: server.sessionId, revision: 1, snapshot: server }));
    await expect(pending).rejects.toThrow("cloud-cancelled");
    expect(controller.getSnapshot().snapshot).toBeUndefined();
    expect(controller.readDraft(other)).toBeNull();
  });
  it("owns a guest personal draft before approval and projects prelogged sets after admission", async () => {
    const d = draft();
    server.hostId = other;
    server.participants[0].execution = {
      exercises: [
        {
          planExerciseId: server.plan.exercises[0].planExerciseId,
          skipped: false,
          sets: [],
        },
      ],
    };
    await controller.join({ sessionId: server.sessionId }, d);
    await controller.retry();
    expect(
      server.participants[0].execution!.exercises[0].sets[0],
    ).toMatchObject({ reps: 8, weightKg: 25 });
    expect(controller.readDraft(userId)?.startedAt).toBe(d.startedAt);
  });
  it("purges cached peer numbers when current consent disappears", async () => {
    await controller.hostWorkout(draft());
    server.participants.push({
      ...copy(server.participants[0]),
      userId: other,
      numbersConsent: undefined,
      previousConsent: undefined,
    });
    await controller.refresh();
    expect(
      controller.getSnapshot().snapshot?.participants[1].execution,
    ).not.toBeNull();
    server.participants[1].numbersAvailable = false;
    server.participants[1].execution = null;
    await controller.refresh();
    expect(
      controller.getSnapshot().snapshot?.participants[1].execution,
    ).toBeNull();
    controller.setActive(false);
    expect(controller.getSnapshot().snapshot).toBeUndefined();
  });
  it("persists atomically across real SQLite reopen without automatic network resume", async () => {
    await controller.hostWorkout(draft());
    controller.setActive(false);
    const local = controller.readDraft(userId)!;
    local.notes = "Offline durable";
    local.exercises[0].sets[0].weightKg = 31;
    controller.saveDraft(userId, local);
    controller.dispose();
    const before = (api.snapshot as jest.Mock).mock.calls.length;
    controller = new TogetherCloudController({
      api,
      db: adapter(db),
      randomUUID,
    });
    controller.setAccount(userId);
    expect(controller.readDraft(userId)?.notes).toBe("Offline durable");
    expect(controller.getSnapshot().phase).toBe("idle");
    expect(api.snapshot).toHaveBeenCalledTimes(before);
    await controller.resume(server.sessionId);
    expect(
      server.participants[0].execution!.exercises[0].sets[0].weightKg,
    ).toBe(31);
  });
  it("rolls back full personal edit when SQLite write fails", async () => {
    await controller.hostWorkout(draft());
    db.exec(
      `CREATE TRIGGER refuse BEFORE UPDATE ON together_cloud_workout BEGIN SELECT RAISE(ABORT,'disk full'); END`,
    );
    const local = controller.readDraft(userId)!;
    local.notes = "must not persist";
    expect(() => controller.saveDraft(userId, local)).toThrow("disk full");
    expect(controller.readDraft(userId)?.notes).toBe("Keep notes");
    expect(api.command).not.toHaveBeenCalled();
  });
  it("retains a pending admission until explicit cancellation and safely detaches full personal work", async () => {
    const requestId = randomUUID();
    api.join = jest.fn(async () =>
      ok({
        requestId,
        sessionId: server.sessionId,
        status: "pending" as const,
      }),
    );
    api.joinStatus = jest.fn(async () =>
      ok({
        requestId,
        sessionId: server.sessionId,
        status: "pending" as const,
      }),
    );
    api.cancelJoin = jest.fn(async () => ok({ cancelled: true }));
    await controller.join({ inviteToken: "opaque" }, draft());
    expect(controller.getSnapshot().phase).toBe("pending-approval");
    expect(() => controller.detachDraft(userId, () => {})).toThrow(
      "cloud-cannot-detach",
    );
    await controller.cancelJoin();
    expect(controller.getSnapshot().canDetachDraft).toBe(true);
    const detached = controller.detachDraft(userId, () => {});
    expect(detached.together).toBeUndefined();
    expect(detached.exercises[0].sets[0].reps).toBe(8);
    expect(controller.readDraft(userId)).toBeNull();
    expect(() => controller.detachDraft(other, () => {})).toThrow(
      "cloud-account",
    );
    await controller.hostWorkout(draft());
  });
  it("creates a canonical blank draft for deliberate join without an existing workout", async () => {
    server.hostId = other;
    server.participants[0].execution = { exercises: [] };
    await controller.join({ sessionId: server.sessionId });
    const own = controller.readDraft(userId)!;
    expect(own.exercises[0].exerciseId).toBe(exerciseId);
    expect(own.exercises[0].sets).toEqual([]);
    expect(own.together?.transport).toBe("cloud");
  });
  it("retains offline own changes and explicitly saves reviewed private continuation", async () => {
    await controller.hostWorkout(draft());
    controller.setActive(false);
    const local = controller.readDraft(userId)!;
    local.exercises[0].sets[0].weightKg = 50;
    controller.saveDraft(userId, local);
    server.sharingActive = false;
    server.state = "closed";
    server.continuation = "solo";
    controller.setActive(true);
    await controller.refresh();
    const review = await controller.prepareReview();
    expect(review.execution.exercises[0].sets[0].weightKg).toBe(50);
    expect(review.omissions).toContain(
      "Notes and location remain on this device.",
    );
    await controller.reviewOwn(review.execution, review.token);
    expect(
      server.participants[0].execution!.exercises[0].sets[0].weightKg,
    ).toBe(50);
    expect(controller.readDraft(userId)?.status).toBe("completed");
  });
  it("mirrors delegated sets without deleting partial personal rows or notes", async () => {
    await controller.hostWorkout(draft());
    const own = server.participants[0].execution!.exercises[0];
    own.sets.push({
      setId: randomUUID(),
      weightKg: 30,
      reps: 4,
      completed: true,
    });
    server.participants[0].ownRevision++;
    server.revision++;
    await controller.refresh();
    expect(controller.readDraft(userId)?.exercises[0].sets).toHaveLength(2);
    expect(controller.readDraft(userId)?.notes).toBe("Keep notes");
  });
  it("requires account, current authority and matching draft for all personal writes", async () => {
    expect(() => controller.saveDraft(other, draft())).toThrow("cloud-account");
    expect(() => controller.saveDraft(userId, draft())).toThrow(
      "cloud-missing-draft",
    );
    await expect(controller.invite()).rejects.toThrow("cloud-not-admitted");
    await expect(controller.resume("not-uuid")).rejects.toThrow(
      "cloud-invalid-session",
    );
    await controller.hostWorkout(draft());
    await expect(controller.resume(randomUUID())).rejects.toThrow(
      "cloud-authority-conflict",
    );
    await expect(
      controller.join({ sessionId: randomUUID() }, draft()),
    ).rejects.toThrow("cloud-workout-exists");
    controller.setActive(false);
    await expect(controller.refresh()).rejects.toThrow("cloud-unavailable");
    controller.setAccount(null);
    expect(controller.readDraft(userId)).toBeNull();
  });
  it("uses scoped consent/delegation and versioned host controls and clears PREV cache on refresh", async () => {
    await controller.hostWorkout(draft());
    api.invite = jest.fn(async () =>
      ok({
        tokenId: randomUUID(),
        token: "secret",
        expiresAt: "2026-10-06T00:00:00.000Z",
      }),
    );
    api.revokeInvite = jest.fn(async () => ok({ revoked: true }));
    api.decide = jest.fn(async () => ok(copy(server)));
    api.remove = jest.fn(async () =>
      ok({ removed: true, snapshot: copy(server) }),
    );
    api.delegation = jest.fn(async () => ok({ generation: 1, allowed: true }));
    api.consent = jest.fn(async (_id, _key, kind, body) =>
      ok({
        sessionId: server.sessionId,
        ownerId: userId,
        version: body.expectedVersion + 1,
        recipientIds: body.recipientIds,
      }),
    );
    api.visibility = jest.fn(async () => ok({ revision: server.revision }));
    api.friends = jest.fn(async () => ok({ data: [], nextCursor: null }));
    api.previous = jest.fn(async () =>
      ok({
        sessionId: server.sessionId,
        ownerId: userId,
        revision: server.revision,
        consentVersion: 0,
        planVersion: server.planVersion,
        ownRevision: server.participants[0].ownRevision,
        values: [],
      }),
    );
    const invite = await controller.invite();
    expect(invite.token).toBe("secret");
    await controller.revokeInvite(invite.tokenId);
    await controller.decide(randomUUID(), "reject");
    await controller.remove(other);
    await controller.delegation(true);
    await controller.numbersConsent([other]);
    await controller.previousConsent([other]);
    await controller.visibility("friends", "2026-10-06T00:00:00.000Z");
    await controller.friends();
    await controller.previous(userId);
    expect(controller.getSnapshot().previous[userId]).toBeDefined();
    await controller.refresh();
    expect(controller.getSnapshot().previous).toEqual({});
    await expect(controller.previous(other)).rejects.toThrow(
      "cloud-previous-forbidden",
    );
    expect((api.consent as jest.Mock).mock.calls.map((c) => c[2])).toEqual([
      "numbers",
      "previous",
    ]);
  });
  it("invalid response and stale PREV never keep partner derived data", async () => {
    await controller.hostWorkout(draft());
    api.previous = jest.fn(async () =>
      ok({
        sessionId: server.sessionId,
        ownerId: userId,
        revision: server.revision,
        consentVersion: 0,
        planVersion: 999,
        ownRevision: 0,
        values: [],
      }),
    );
    await expect(controller.previous(userId)).rejects.toThrow(
      "cloud-previous-stale",
    );
    api.snapshot = jest.fn(async () =>
      ok({ ...copy(server), participants: [] }),
    );
    await expect(controller.refresh()).rejects.toThrow(
      "cloud-invalid-response",
    );
    expect(controller.getSnapshot().snapshot?.participants).toHaveLength(1);
  });
  it("host close and guest leave use exactly the displayed acknowledged revision", async () => {
    await controller.hostWorkout(draft());
    api.close = jest.fn(async () =>
      ok({
        status: "pending" as const,
        historyId: null,
        revision: 2,
        ownRevision: 0,
        sharingActive: false as const,
        recoveryMayBePending: true as const,
        acknowledgedStateOnly: true as const,
        mode: "save_own" as const,
      }),
    );
    await controller.close("save_own", controller.reviewToken());
    expect(api.close).toHaveBeenCalledWith(
      server.sessionId,
      expect.any(String),
      {
        mode: "save_own",
        expectedRevision: server.revision,
        expectedOwnRevision: 0,
      },
    );
    await controller.leave(controller.reviewToken());
    expect(api.finish).toHaveBeenLastCalledWith(
      server.sessionId,
      expect.any(String),
      0,
      true,
    );
    expect(() =>
      controller.saveDraft(userId, controller.readDraft(userId)!),
    ).toThrow("cloud-workout-finished");
  });
  it("coalesces listeners/polling, ignores old snapshots and preserves current authority on cancellation", async () => {
    jest.useFakeTimers();
    const callback = jest.fn();
    const unsubscribe = controller.subscribe(callback);
    controller.subscribe(() => {
      throw Error("render");
    });
    await controller.hostWorkout(draft());
    expect(callback).toHaveBeenCalled();
    unsubscribe();
    const count = callback.mock.calls.length;
    controller.setAccount(userId);
    controller.setActive(true);
    await controller.publishOwnDraft();
    expect(callback).toHaveBeenCalledTimes(count);
    server.revision = -1;
    await expect(controller.refresh()).rejects.toThrow(
      "cloud-invalid-response",
    );
    server.revision = 0;
    await controller.refresh();
    expect(controller.getSnapshot().snapshot?.revision).toBe(1);
    server.revision = 1;
    await jest.advanceTimersByTimeAsync(5000);
    expect(api.snapshot).toHaveBeenCalled();
    controller.cancel();
    expect(controller.getSnapshot().phase).toBe("idle");
    expect(controller.readDraft(userId)).not.toBeNull();
    jest.useRealTimers();
  });
  it("does not issue a request from empty state and serializes duplicate refresh calls", async () => {
    await controller.refresh();
    expect(api.snapshot).not.toHaveBeenCalled();
    await expect(controller.publishOwnDraft()).rejects.toThrow(
      "cloud-missing-draft",
    );
    await controller.hostWorkout(draft());
    let resolve!: (value: any) => void;
    api.snapshot = jest.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const one = controller.refresh();
    const two = controller.refresh();
    resolve(ok(copy(server)));
    await Promise.all([one, two]);
    expect(api.snapshot).toHaveBeenCalledTimes(1);
  });
  it("keeps full incompatible guest plan and rejects unsafe finish", async () => {
    server.plan.exercises[0].exerciseId = randomUUID();
    await controller.join({ sessionId: server.sessionId }, draft());
    expect(controller.getSnapshot().error).toBe("cloud-plan-mismatch");
    expect(controller.readDraft(userId)?.exercises[0].exerciseId).toBe(
      exerciseId,
    );
    await expect(controller.publishOwnDraft()).rejects.toThrow(
      "cloud-plan-mismatch",
    );
    await expect(controller.finish(controller.reviewToken())).rejects.toThrow(
      "cloud-unsaved-work",
    );
    await expect(
      controller.close("finish_all", controller.reviewToken()),
    ).rejects.toThrow("cloud-unsaved-work");
  });
  it("binds edits queued while host creation is in flight to the actual server identity", async () => {
    const original = api.create;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    api.create = jest.fn(async (...args) => {
      await gate;
      return original(...args);
    });
    const hosting = controller.hostWorkout(draft());
    const local = controller.readDraft(userId)!;
    local.exercises[0].sets[0].weightKg = 29;
    controller.saveDraft(userId, local);
    release();
    await hosting;
    await controller.retry();
    expect(api.command).toHaveBeenCalledWith(
      server.sessionId,
      expect.any(String),
      expect.objectContaining({ expectedVersion: 0 }),
    );
    expect(
      server.participants[0].execution!.exercises[0].sets[0].weightKg,
    ).toBe(29);
  });
  it("sign-out late PREV never republishes scoped values", async () => {
    await controller.hostWorkout(draft());
    let resolve!: (value: any) => void;
    api.previous = jest.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = controller.previous(userId);
    controller.setAccount(other);
    resolve(
      ok({
        sessionId: server.sessionId,
        ownerId: userId,
        revision: 1,
        consentVersion: 0,
        planVersion: 1,
        ownRevision: 0,
        values: [],
      }),
    );
    await expect(pending).rejects.toThrow("cloud-cancelled");
    expect(controller.getSnapshot().previous).toEqual({});
  });
  it("versioned manual owner command refreshes into own draft", async () => {
    await controller.hostWorkout(draft());
    await controller.command({
      expectedVersion: 0,
      target: { kind: "execution" },
      operation: { type: "rest", endsAt: null },
    });
    expect(server.participants[0].ownRevision).toBe(1);
  });
  it("never accepts review execution different from the displayed personal candidate", async () => {
    await controller.hostWorkout(draft());
    const active = await controller.prepareReview();
    await expect(
      controller.reviewOwn(active.execution, active.token),
    ).rejects.toThrow("cloud-sharing-active");
    server.state = "closed";
    server.sharingActive = false;
    await controller.refresh();
    const review = await controller.prepareReview();
    await expect(
      controller.reviewOwn({ exercises: [] }, review.token),
    ).rejects.toThrow("cloud-review-stale");
    server.participants[0].status = "finalizing";
    await controller.refresh();
    const finalizing = await controller.prepareReview();
    await expect(
      controller.reviewOwn(finalizing.execution, finalizing.token),
    ).rejects.toThrow("cloud-finalizing");
  });
  it("rejects cross-account host inputs and preserves original personal snapshot while create is ambiguous", async () => {
    await expect(
      controller.hostWorkout({ ...draft(), userId: other }),
    ).rejects.toThrow("cloud-account");
    const d = promoteCloudDraft(draft(), randomUUID).draft;
    d.personalDraft!.userId = other;
    await expect(controller.host(d)).rejects.toThrow("cloud-account");
    await expect(
      controller.join(
        { sessionId: server.sessionId },
        { ...draft(), together: { sessionId: other, executionId: other } },
      ),
    ).rejects.toThrow("cloud-authority-conflict");
    await expect(controller.cancelJoin()).rejects.toThrow("cloud-not-pending");
    await controller.hostWorkout(draft());
    await expect(
      controller.host(promoteCloudDraft(draft(), randomUUID).draft),
    ).rejects.toThrow("cloud-workout-exists");
  });
  it("resumes server own results without deleting previously logged canonical sets", async () => {
    await controller.resume(server.sessionId);
    expect(controller.readDraft(userId)?.exercises[0].sets[0]).toMatchObject({
      reps: 8,
      weightKg: 25,
    });
    expect(api.command).not.toHaveBeenCalled();
  });
  it("direct canonical host creates a personal mirror and supports empty result retirement", async () => {
    const d = promoteCloudDraft(draft(), randomUUID).draft;
    delete d.personalDraft;
    d.ownExecution = { exercises: [] };
    await controller.host(d);
    expect(controller.readDraft(userId)?.notes).toBeNull();
    const review = await controller.prepareReview();
    expect(review.omissions).toEqual([]);
    server.participants[0].status = "finished_empty";
    server.completion.status = "finished_empty";
    await controller.refresh();
    expect(controller.readDraft(userId)?.status).toBe("cancelled");
  });
  it("keeps pending own edits before host approval and projects them only after admitted plan arrives", async () => {
    const requestId = randomUUID();
    api.join = jest.fn(async () =>
      ok({
        requestId,
        sessionId: server.sessionId,
        status: "pending" as const,
      }),
    );
    api.joinStatus = jest.fn(async () =>
      ok({
        requestId,
        sessionId: server.sessionId,
        status: "pending" as const,
      }),
    );
    await controller.join({ sessionId: server.sessionId }, draft());
    const local = controller.readDraft(userId)!;
    local.exercises[0].sets[0].reps = 11;
    controller.saveDraft(userId, local);
    await controller.retry();
    expect(api.command).not.toHaveBeenCalled();
    server.hostId = other;
    server.participants[0].execution = {
      exercises: [
        {
          planExerciseId: server.plan.exercises[0].planExerciseId,
          skipped: false,
          sets: [],
        },
      ],
    };
    api.joinStatus = jest.fn(async () =>
      ok({
        requestId,
        sessionId: server.sessionId,
        status: "approved" as const,
      }),
    );
    await controller.refresh();
    await controller.retry();
    expect(server.participants[0].execution!.exercises[0].sets[0].reps).toBe(
      11,
    );
  });
  it("definitive rejection can detach while missing server identity never becomes an admitted session", async () => {
    const requestId = randomUUID();
    api.join = jest.fn(async () =>
      ok({
        requestId,
        sessionId: server.sessionId,
        status: "pending" as const,
      }),
    );
    api.joinStatus = jest.fn(async () =>
      ok({
        requestId,
        sessionId: server.sessionId,
        status: "rejected" as const,
      }),
    );
    await expect(
      controller.join({ sessionId: server.sessionId }, draft()),
    ).rejects.toThrow("cloud-join-rejected");
    expect(controller.getSnapshot().canDetachDraft).toBe(true);
    expect(controller.detachDraft(userId, () => {}).notes).toBe("Keep notes");
  });
  it("rejects foreign session and missing owner replies without replacing authoritative own draft", async () => {
    await controller.hostWorkout(draft());
    const original = server.sessionId;
    server.sessionId = randomUUID();
    await expect(controller.refresh()).rejects.toThrow(
      "cloud-authority-conflict",
    );
    server.sessionId = original;
    server.participants[0].userId = other;
    await expect(controller.refresh()).rejects.toThrow(
      "cloud-invalid-response",
    );
    expect(controller.readDraft(userId)?.userId).toBe(userId);
  });
  it("review detects incomplete sets and saved result amendments keep full local annotations", async () => {
    await controller.hostWorkout(draft());
    controller.setActive(false);
    const local = controller.readDraft(userId)!;
    local.exercises[0].sets[0].reps = null;
    controller.saveDraft(userId, local);
    controller.setActive(true);
    server.sharingActive = false;
    server.state = "closed";
    server.participants[0].status = "saved";
    await controller.refresh();
    const review = await controller.prepareReview();
    expect(review.omissions).toContain(
      "Incomplete sets remain on this device.",
    );
    await controller.reviewOwn(review.execution, review.token);
    expect(api.review).toHaveBeenCalledWith(
      server.sessionId,
      expect.any(String),
      expect.objectContaining({ execution: review.execution }),
    );
    expect(controller.readDraft(userId)?.status).toBe("completed");
  });
  it("refuses a fresh finish while a pending numeric edit is still unacknowledged", async () => {
    await controller.hostWorkout(draft());
    api.command = jest.fn(async () =>
      fail({
        kind: "api" as const,
        code: "network" as const,
        message: "offline",
      }),
    );
    const local = controller.readDraft(userId)!;
    local.exercises[0].sets[0].weightKg = 27;
    controller.saveDraft(userId, local);
    await expect(controller.retry()).rejects.toThrow("network");
    await expect(controller.finish(controller.reviewToken())).rejects.toThrow(
      "cloud-unsaved-work",
    );
    expect(controller.readDraft(userId)?.exercises[0].sets[0].weightKg).toBe(
      27,
    );
  });
  it("permission metadata missing from server never creates an implicit numeric consent", async () => {
    await controller.hostWorkout(draft());
    delete server.participants[0].numbersConsent;
    await controller.refresh();
    await expect(controller.numbersConsent([other])).rejects.toThrow(
      "cloud-invalid-response",
    );
  });
  it("rolls back failed personal detach handoff so the original draft stays accessible", async () => {
    const requestId = randomUUID();
    api.join = jest.fn(async () =>
      ok({
        requestId,
        sessionId: server.sessionId,
        status: "pending" as const,
      }),
    );
    api.joinStatus = jest.fn(async () =>
      ok({
        requestId,
        sessionId: server.sessionId,
        status: "rejected" as const,
      }),
    );
    await expect(
      controller.join({ sessionId: server.sessionId }, draft()),
    ).rejects.toThrow("cloud-join-rejected");
    expect(() =>
      controller.detachDraft(userId, () => {
        throw Error("personal disk full");
      }),
    ).toThrow("personal disk full");
    expect(controller.readDraft(userId)?.together?.transport).toBe("cloud");
    expect(controller.getSnapshot().canDetachDraft).toBe(true);
    const write = jest.fn();
    controller.detachDraft(userId, write);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "Keep notes" }),
    );
    expect(controller.readDraft(userId)).toBeNull();
  });
  it("reopens the SQLite file with stable own IDs and durable unacknowledged edits", async () => {
    controller.dispose();
    db.close();
    directory = mkdtempSync(join(tmpdir(), "together-cloud-"));
    const path = join(directory, "cloud.sqlite");
    db = new DatabaseSync(path);
    controller = new TogetherCloudController({
      api,
      db: adapter(db),
      randomUUID,
    });
    controller.setAccount(userId);
    await controller.hostWorkout(draft());
    controller.setActive(false);
    const local = controller.readDraft(userId)!;
    const marker = local.together;
    local.exercises[0].sets[0].weightKg = 45;
    controller.saveDraft(userId, local);
    controller.dispose();
    db.close();
    db = new DatabaseSync(path);
    controller = new TogetherCloudController({
      api,
      db: adapter(db),
      randomUUID,
    });
    controller.setAccount(other);
    expect(controller.readDraft(userId)).toBeNull();
    controller.setAccount(userId);
    expect(controller.readDraft(userId)?.together).toEqual(marker);
    expect(controller.readDraft(userId)?.exercises[0].sets[0].weightKg).toBe(
      45,
    );
    await controller.retry();
    expect(
      server.participants[0].execution!.exercises[0].sets[0].weightKg,
    ).toBe(45);
  });
  it("returns each mutation own result when another action is queued during the same drain", async () => {
    await controller.hostWorkout(draft());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.invite = jest.fn(async () => {
      await gate;
      return ok({
        tokenId: other,
        token: "my-invite",
        expiresAt: "2026-10-06T00:00:00.000Z",
      });
    });
    api.delegation = jest.fn(async () => ok({ generation: 1, allowed: true }));
    const invite = controller.invite();
    const delegated = controller.delegation(true);
    release();
    expect((await invite).token).toBe("my-invite");
    await delegated;
  });
  it("explicitly saves only last supported sets while keeping a full unsupported draft active", async () => {
    await controller.hostWorkout(draft());
    controller.setActive(false);
    const local = controller.readDraft(userId)!;
    local.exercises[0].sets[0].rpe = 9;
    local.exercises[0].sets[0].weightKg = 77;
    controller.saveDraft(userId, local);
    controller.setActive(true);
    await controller.refresh();
    const review = await controller.prepareReview();
    expect(review.retainedLocalChanges).toBe(true);
    expect(review.execution.exercises[0].sets[0].weightKg).toBe(25);
    await controller.finish(review.token);
    expect(controller.readDraft(userId)?.status).toBe("in_progress");
    expect(controller.readDraft(userId)?.exercises[0].sets[0]).toMatchObject({
      weightKg: 77,
      rpe: 9,
    });
    await controller.refresh();
    expect(controller.readDraft(userId)?.exercises[0].sets[0].weightKg).toBe(
      77,
    );
  });
  it("preserves actual catalog category on remote-only drafts and guards late friend discovery", async () => {
    server.participants[0].exerciseCatalog[exerciseId].category = "cardio";
    server.participants[0].execution = { exercises: [] };
    await controller.resume(server.sessionId);
    expect(controller.readDraft(userId)?.exercises[0].category).toBe("cardio");
    expect((await controller.prepareReview()).retainedLocalChanges).toBe(true);
    let resolve!: (value: any) => void;
    api.friends = jest.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const search = controller.friends();
    controller.setAccount(other);
    resolve(ok({ data: [], nextCursor: null }));
    await expect(search).rejects.toThrow("cloud-cancelled");
  });
  it("waits for an invite queued during the previous drain tail refresh to actually complete", async () => {
    await controller.hostWorkout(draft());
    const originalSnapshot = api.snapshot;
    let releaseRefresh!: (value: unknown) => void;
    let refreshStarted!: () => void;
    const refreshEntered = new Promise<void>((r) => {
      refreshStarted = r;
    });
    api.snapshot = jest
      .fn()
      .mockImplementationOnce(() => {
        refreshStarted();
        return new Promise((resolve) => {
          releaseRefresh = resolve;
        });
      })
      .mockImplementation(originalSnapshot);
    const prior = controller.retry();
    await refreshEntered;
    let releaseInvite!: (
      value: Awaited<ReturnType<TogetherCloudApi["invite"]>>,
    ) => void;
    let inviteStarted!: () => void;
    const inviteEntered = new Promise<void>((r) => {
      inviteStarted = r;
    });
    api.invite = jest.fn(() => {
      inviteStarted();
      return new Promise((resolve) => {
        releaseInvite = resolve;
      });
    });
    let settled = false;
    const invite = controller.invite().then((value) => {
      settled = true;
      return value;
    });
    expect(api.invite).not.toHaveBeenCalled();
    releaseRefresh(ok(copy(server)));
    await inviteEntered;
    await prior;
    expect(settled).toBe(false);
    expect(controller.getSnapshot().pendingCount).toBe(1);
    releaseInvite(
      ok({
        tokenId: other,
        token: "tail-invite",
        expiresAt: "2026-10-06T00:00:00.000Z",
      }),
    );
    expect((await invite).token).toBe("tail-invite");
    expect(controller.getSnapshot().pendingCount).toBe(0);
  });
  it("propagates a command failure queued during tail refresh without premature success", async () => {
    await controller.hostWorkout(draft());
    const originalSnapshot = api.snapshot;
    let releaseRefresh!: (value: unknown) => void;
    let entered!: () => void;
    const refreshing = new Promise<void>((r) => {
      entered = r;
    });
    api.snapshot = jest
      .fn()
      .mockImplementationOnce(() => {
        entered();
        return new Promise((resolve) => {
          releaseRefresh = resolve;
        });
      })
      .mockImplementation(originalSnapshot);
    const prior = controller.retry();
    await refreshing;
    let releaseCommand!: (
      value: Awaited<ReturnType<TogetherCloudApi["command"]>>,
    ) => void;
    let sent!: () => void;
    const sending = new Promise<void>((r) => {
      sent = r;
    });
    api.command = jest.fn(() => {
      sent();
      return new Promise((resolve) => {
        releaseCommand = resolve;
      });
    });
    let settled = false;
    const command = controller
      .command({
        expectedVersion: 0,
        target: { kind: "execution", athleteId: userId },
        operation: { type: "rest", endsAt: null },
      })
      .then(
        () => {
          settled = true;
        },
        (error) => {
          settled = true;
          throw error;
        },
      );
    const failed = expect(command).rejects.toThrow("network");
    releaseRefresh(ok(copy(server)));
    await sending;
    await prior;
    expect(settled).toBe(false);
    releaseCommand(fail({ kind: "api", code: "network", message: "offline" }));
    await failed;
    expect(controller.getSnapshot().pendingCount).toBe(1);
  });
});
