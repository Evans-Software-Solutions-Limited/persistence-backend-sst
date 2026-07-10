/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: vi.fn(),
}));

vi.mock("../../../relationships/auditTrainerAction", () => ({
  auditTrainerAction: vi.fn(async () => {}),
}));

const recordSession = vi.fn();
vi.mock("../../../repositories/sessionRepository", () => ({
  SessionRepository: vi.fn(() => ({ recordSession })),
}));

const recordPRsForSession = vi.fn(async () => []);
vi.mock("../../../repositories/personalRecordsRepository", () => ({
  PersonalRecordsRepository: vi.fn(() => ({ recordPRsForSession })),
}));

const linkCompletedSession = vi.fn(async () => {});
vi.mock("../../../repositories/programAssignmentRepository", () => ({
  ProgramAssignmentRepository: vi.fn(() => ({ linkCompletedSession })),
}));

vi.mock("../../../streaks/evaluate", () => ({
  safeEvaluateStreaks: vi.fn(async () => ({ advanced: [], milestones: [] })),
  resolveEventTs: vi.fn(() => new Date("2026-05-04T11:00:00.000Z")),
}));

vi.mock("../../../progress/recompute", () => ({
  safeRecomputeVolume: vi.fn(async () => {}),
}));

vi.mock("../../onBehalfNotifications", () => ({
  emitTrainerOnBehalfNotification: vi.fn(async () => {}),
}));

import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { safeEvaluateStreaks } from "../../../streaks/evaluate";
import { safeRecomputeVolume } from "../../../progress/recompute";
import { emitTrainerOnBehalfNotification } from "../../onBehalfNotifications";
import { recordClientSessionOnBehalf } from "../recordClientSession";

const basePayload = {
  workoutId: "w-1",
  name: "Push Day",
  startedAt: "2026-05-04T10:00:00.000Z",
  completedAt: "2026-05-04T11:00:00.000Z",
  status: "completed" as const,
  exercises: [
    {
      exerciseId: "ex-1",
      sortOrder: 1,
      sets: [{ setNumber: 1, reps: 5, weightKg: 100 }],
    },
  ],
};

const ARGS = {
  trainerId: "trainer-1",
  clientId: "client-1",
  payload: basePayload,
};

/** The recorded-session stub recordSession resolves with. */
function recordedStub(
  status: "completed" | "cancelled" = "completed",
  wasReplay = false,
) {
  return {
    id: "s-1",
    userId: "client-1",
    loggedByUserId: "trainer-1",
    status,
    personalRecords: [],
    workoutsThisMonth: 1,
    exercises: [],
    wasReplay,
  };
}

describe("recordClientSessionOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    recordSession.mockResolvedValue(recordedStub("completed"));
  });

  it("403s when the gate denies (and never records)", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      status: 403,
      body: { code: "wrong_role", message: "Not a trainer." },
    });

    const result = await recordClientSessionOnBehalf(ARGS);

    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "wrong_role", message: "Not a trainer." },
    });
    expect(recordSession).not.toHaveBeenCalled();
  });

  it("records for the CLIENT with loggedByUserId=trainer + a completed-only link hook", async () => {
    const result = await recordClientSessionOnBehalf(ARGS);

    expect(result.ok).toBe(true);
    // recordSession(clientId, payload, prFn, afterCompletedRecord, options)
    const call = recordSession.mock.calls[0];
    expect(call[0]).toBe("client-1");
    expect(call[1]).toBe(basePayload);
    expect(typeof call[2]).toBe("function"); // PR detection
    expect(typeof call[3]).toBe("function"); // afterCompletedRecord (workoutId present)
    expect(call[4]).toMatchObject({ loggedByUserId: "trainer-1" });
    expect(typeof call[4].afterRecord).toBe("function");
  });

  it("passes NO afterCompletedRecord hook when the session has no workoutId", async () => {
    await recordClientSessionOnBehalf({
      ...ARGS,
      payload: { ...basePayload, workoutId: null },
    });
    const call = recordSession.mock.calls[0];
    expect(call[3]).toBeUndefined();
  });

  it("afterRecord hook writes a workout_logged_on_behalf audit row on the passed tx", async () => {
    await recordClientSessionOnBehalf(ARGS);
    const options = recordSession.mock.calls[0][4];
    const fakeTx = { marker: "tx" } as any;

    await options.afterRecord("client-1", "s-1", fakeTx);

    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        trainerId: "trainer-1",
        clientId: "client-1",
        actionType: "workout_logged_on_behalf",
        targetTable: "workout_sessions",
        targetRowId: "s-1",
        tx: fakeTx,
      }),
    );
    // The audit payload is a summary, not the full sets body.
    const auditArg = (auditTrainerAction as any).mock.calls[0][0];
    expect(auditArg.payload).toEqual({
      workoutId: "w-1",
      name: "Push Day",
      status: "completed",
      exerciseCount: 1,
      completedAt: "2026-05-04T11:00:00.000Z",
    });
  });

  it("afterCompletedRecord hook links the completed session to the client's occurrence", async () => {
    await recordClientSessionOnBehalf(ARGS);
    const afterCompletedRecord = recordSession.mock.calls[0][3];
    const fakeTx = { marker: "tx" } as any;

    await afterCompletedRecord("client-1", "s-1", fakeTx);

    expect(linkCompletedSession).toHaveBeenCalledWith(
      "client-1",
      "w-1",
      "s-1",
      fakeTx,
    );
  });

  it("advances streaks + volume + notifies (all scoped to the CLIENT) for a completed session", async () => {
    await recordClientSessionOnBehalf(ARGS);

    expect(safeEvaluateStreaks).toHaveBeenCalledWith(
      "client-1",
      "workout_logged",
      expect.any(Date),
    );
    expect(safeRecomputeVolume).toHaveBeenCalledWith("client-1");
    expect(emitTrainerOnBehalfNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        trainerId: "trainer-1",
        type: "workout_logged_on_behalf",
        relatedEntityId: "s-1",
      }),
    );
  });

  it("does NOT re-notify/streak/volume on an idempotent REPLAY (M13 — same completed session returned)", async () => {
    // A retried on-behalf record (lost ack) short-circuits to the already-
    // committed session: status "completed" but wasReplay true. Without the
    // guard the sync queue's retries would re-fire the client push on every
    // attempt.
    recordSession.mockResolvedValue(recordedStub("completed", true));

    const result = await recordClientSessionOnBehalf(ARGS);

    expect(result.ok).toBe(true);
    expect(safeEvaluateStreaks).not.toHaveBeenCalled();
    expect(safeRecomputeVolume).not.toHaveBeenCalled();
    expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
  });

  it("does NOT advance streaks/volume/notify for a cancelled (discarded) session", async () => {
    recordSession.mockResolvedValue(recordedStub("cancelled"));

    const result = await recordClientSessionOnBehalf({
      ...ARGS,
      payload: { ...basePayload, status: "cancelled" },
    });

    expect(result.ok).toBe(true);
    expect(safeEvaluateStreaks).not.toHaveBeenCalled();
    expect(safeRecomputeVolume).not.toHaveBeenCalled();
    expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
    // …but it was still recorded with the audit hook wired.
    expect(typeof recordSession.mock.calls[0][4].afterRecord).toBe("function");
  });
});
