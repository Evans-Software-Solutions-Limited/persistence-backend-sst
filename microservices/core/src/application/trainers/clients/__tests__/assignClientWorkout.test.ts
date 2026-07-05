/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: vi.fn(),
}));

vi.mock("../../../relationships/auditTrainerAction", () => ({
  auditTrainerAction: vi.fn(),
}));

const repoCreateAdHoc = vi.fn();
vi.mock("../../../repositories/programAssignmentRepository", () => ({
  ProgramAssignmentRepository: vi.fn(() => ({ createAdHoc: repoCreateAdHoc })),
}));

vi.mock("../../programs/shared", () => ({
  todayIso: vi.fn(() => "2026-07-05"),
  ISO_DATE_PATTERN: "",
}));

vi.mock("../../onBehalfNotifications", () => ({
  emitTrainerOnBehalfNotification: vi.fn(async () => {}),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { emitTrainerOnBehalfNotification } from "../../onBehalfNotifications";
import { assignClientWorkoutOnBehalf } from "../assignClientWorkout";

function makeDb(txStub: unknown = {}) {
  return {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(txStub),
    ),
  };
}

const ARGS = {
  trainerId: "trainer-1",
  clientId: "client-1",
  body: { workoutId: "w-1", trainerNotes: "focus on form" },
};

describe("assignClientWorkoutOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as any).mockReturnValue(makeDb());
    repoCreateAdHoc.mockResolvedValue({ assignment: { id: "wa-1" } });
    (auditTrainerAction as any).mockResolvedValue(undefined);
  });

  it("403s with wrong_role when the caller isn't a trainer", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "wrong_role",
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    const result = await assignClientWorkoutOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    expect(repoCreateAdHoc).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("403s with no_relationship when there's no active relationship", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const result = await assignClientWorkoutOnBehalf(ARGS);
    expect(result.ok).toBe(false);
    expect(repoCreateAdHoc).not.toHaveBeenCalled();
  });

  it("422 invalid_workout when the workout isn't the trainer's own or public (no audit, no notify)", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    repoCreateAdHoc.mockResolvedValue({ error: "invalid_workout" });
    const result = await assignClientWorkoutOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 422,
      body: {
        code: "invalid_workout",
        message: "The workout must be your own or public",
      },
    });
    expect(auditTrainerAction).not.toHaveBeenCalled();
    expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
  });

  it("happy path: creates the assignment on the tx, audits (workout_assigned), notifies", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    const txStub = { marker: "tx" };
    (getDb as any).mockReturnValue(makeDb(txStub));

    const result = await assignClientWorkoutOnBehalf(ARGS);

    expect(result).toEqual({ ok: true, assignment: { id: "wa-1" } });
    expect(repoCreateAdHoc).toHaveBeenCalledWith(
      "trainer-1",
      "client-1",
      expect.objectContaining({ workoutId: "w-1" }),
      "2026-07-05",
      txStub,
    );
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "workout_assigned",
        targetTable: "workout_assignments",
        targetRowId: "wa-1",
        payload: ARGS.body,
        tx: txStub,
      }),
    );
    expect(emitTrainerOnBehalfNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "workout_assigned",
        deepLink: "/workouts/w-1",
        relatedEntityType: "workout_assignment",
        relatedEntityId: "wa-1",
      }),
    );
  });

  it("rolls back (no notification) if the audit write throws", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    (auditTrainerAction as any).mockRejectedValue(new Error("audit failed"));
    await expect(assignClientWorkoutOnBehalf(ARGS)).rejects.toThrow(
      "audit failed",
    );
    expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
  });
});
