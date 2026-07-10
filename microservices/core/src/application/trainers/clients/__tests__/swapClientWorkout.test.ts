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

const repoSwap = vi.fn();
vi.mock("../../../repositories/programAssignmentRepository", () => ({
  ProgramAssignmentRepository: vi.fn(() => ({ swapAssignment: repoSwap })),
}));

vi.mock("../../onBehalfNotifications", () => ({
  emitTrainerOnBehalfNotification: vi.fn(async () => {}),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { emitTrainerOnBehalfNotification } from "../../onBehalfNotifications";
import { swapClientWorkoutOnBehalf } from "../swapClientWorkout";

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
  assignmentId: "wa-1",
  body: { workoutId: "w-new" },
};

describe("swapClientWorkoutOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as any).mockReturnValue(makeDb());
    repoSwap.mockResolvedValue({
      result: "swapped",
      assignment: { id: "wa-1", workoutId: "w-new" },
      fromWorkoutId: "w-old",
    });
    (auditTrainerAction as any).mockResolvedValue(undefined);
  });

  it("403s when the caller can't act for the client — no swap, no audit", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "wrong_role",
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    const result = await swapClientWorkoutOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    expect(repoSwap).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
    expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
  });

  it("happy path: swaps on the tx, audits (workout_swapped from→to), notifies", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    const txStub = { marker: "tx" };
    (getDb as any).mockReturnValue(makeDb(txStub));

    const result = await swapClientWorkoutOnBehalf(ARGS);

    expect(result).toEqual({
      ok: true,
      assignment: { id: "wa-1", workoutId: "w-new" },
    });
    expect(repoSwap).toHaveBeenCalledWith(
      "trainer-1",
      "client-1",
      "wa-1",
      "w-new",
      txStub,
    );
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "workout_swapped",
        targetTable: "workout_assignments",
        targetRowId: "wa-1",
        payload: { fromWorkoutId: "w-old", toWorkoutId: "w-new" },
        tx: txStub,
      }),
    );
    expect(emitTrainerOnBehalfNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "workout_assigned",
        deepLink: "/workouts/w-new",
        relatedEntityType: "workout_assignment",
        relatedEntityId: "wa-1",
      }),
    );
  });

  it.each([
    ["not_found", 404, "not_found"],
    ["not_swappable", 409, "not_swappable"],
    ["invalid_workout", 422, "invalid_workout"],
    ["same_workout", 422, "same_workout"],
  ] as const)(
    "maps repo result %s to %d without auditing or notifying",
    async (repoResult, status, code) => {
      (assertTrainerCanActForClient as any).mockResolvedValue({
        allowed: true,
      });
      repoSwap.mockResolvedValue({ result: repoResult });
      const result = await swapClientWorkoutOnBehalf(ARGS);
      expect(result.ok).toBe(false);
      expect((result as any).status).toBe(status);
      expect((result as any).body.code).toBe(code);
      expect(auditTrainerAction).not.toHaveBeenCalled();
      expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
    },
  );

  it("rolls back (no notification) if the audit write throws", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    (auditTrainerAction as any).mockRejectedValue(new Error("audit failed"));
    await expect(swapClientWorkoutOnBehalf(ARGS)).rejects.toThrow(
      "audit failed",
    );
    expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
  });
});
