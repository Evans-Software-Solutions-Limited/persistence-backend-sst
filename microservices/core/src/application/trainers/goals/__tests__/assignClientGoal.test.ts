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

const repoCreate = vi.fn();
vi.mock("../../../repositories/goalRepository", () => ({
  GoalRepository: vi.fn(() => ({ create: repoCreate })),
}));

vi.mock("../../onBehalfNotifications", () => ({
  emitTrainerOnBehalfNotification: vi.fn(async () => {}),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { emitTrainerOnBehalfNotification } from "../../onBehalfNotifications";
import { assignClientGoalOnBehalf } from "../assignClientGoal";

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
  body: { goalTypeId: "gt-1", notes: "3x/week" },
};

describe("assignClientGoalOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as any).mockReturnValue(makeDb());
    repoCreate.mockResolvedValue({
      id: "g-1",
      userId: "client-1",
      assignedByUserId: "trainer-1",
    });
    (auditTrainerAction as any).mockResolvedValue(undefined);
  });

  it("403s with wrong_role when the caller isn't a trainer", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "wrong_role",
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    const result = await assignClientGoalOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    expect(repoCreate).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("403s with no_relationship when there's no active relationship", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const result = await assignClientGoalOnBehalf(ARGS);
    expect(result.ok).toBe(false);
    expect(repoCreate).not.toHaveBeenCalled();
  });

  it("happy path: creates goal with assigned_by = trainer, audits (goal_assigned) in the tx, notifies", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    const txStub = { marker: "tx" };
    (getDb as any).mockReturnValue(makeDb(txStub));

    const result = await assignClientGoalOnBehalf(ARGS);

    expect(result).toEqual({
      ok: true,
      goal: expect.objectContaining({ id: "g-1" }),
    });
    expect(repoCreate).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({
        goalTypeId: "gt-1",
        assignedByUserId: "trainer-1",
        notes: "3x/week",
      }),
      txStub,
    );
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "goal_assigned",
        targetTable: "user_goals",
        targetRowId: "g-1",
        payload: ARGS.body,
        tx: txStub,
      }),
    );
    expect(emitTrainerOnBehalfNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "goal_assigned_by_trainer",
        deepLink: "/progress/goals/g-1",
        relatedEntityType: "user_goal",
        relatedEntityId: "g-1",
      }),
    );
  });

  it("rolls back (no notification) if the audit write throws", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    (auditTrainerAction as any).mockRejectedValue(new Error("audit failed"));
    await expect(assignClientGoalOnBehalf(ARGS)).rejects.toThrow(
      "audit failed",
    );
    expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
  });
});
