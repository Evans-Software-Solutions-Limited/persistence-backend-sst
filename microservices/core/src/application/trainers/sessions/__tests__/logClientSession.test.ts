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
vi.mock("../../../repositories/sessionRepository", () => ({
  SessionRepository: vi.fn(() => ({ create: repoCreate })),
}));

vi.mock("../../onBehalfNotifications", () => ({
  emitTrainerOnBehalfNotification: vi.fn(async () => {}),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { emitTrainerOnBehalfNotification } from "../../onBehalfNotifications";
import { logClientSessionOnBehalf } from "../logClientSession";

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
  body: { workoutId: "w-1", name: "Leg day", status: "completed" as const },
};

describe("logClientSessionOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as any).mockReturnValue(makeDb());
    repoCreate.mockResolvedValue({
      id: "s-1",
      userId: "client-1",
      loggedByUserId: "trainer-1",
      status: "completed",
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

    const result = await logClientSessionOnBehalf(ARGS);

    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    expect(repoCreate).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
    expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
  });

  it("403s with no_relationship when there's no active relationship", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });

    const result = await logClientSessionOnBehalf(ARGS);

    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    expect(repoCreate).not.toHaveBeenCalled();
  });

  it("happy path: creates the session for the client stamped with the trainer, audits inside the tx, notifies", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    const txStub = { marker: "tx" };
    (getDb as any).mockReturnValue(makeDb(txStub));

    const result = await logClientSessionOnBehalf(ARGS);

    expect(result).toEqual({
      ok: true,
      session: expect.objectContaining({ id: "s-1" }),
    });

    expect(repoCreate).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({
        loggedByUserId: "trainer-1",
        workoutId: "w-1",
        name: "Leg day",
        status: "completed",
      }),
      txStub,
    );

    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        trainerId: "trainer-1",
        clientId: "client-1",
        actionType: "workout_logged_on_behalf",
        targetTable: "workout_sessions",
        targetRowId: "s-1",
        payload: ARGS.body,
        tx: txStub,
      }),
    );

    expect(emitTrainerOnBehalfNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        trainerId: "trainer-1",
        type: "workout_logged_on_behalf",
        deepLink: "/sessions/s-1",
        relatedEntityType: "workout_session",
        relatedEntityId: "s-1",
      }),
    );
  });

  it("defaults status to 'completed' when the body omits it", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    await logClientSessionOnBehalf({
      trainerId: "trainer-1",
      clientId: "client-1",
      body: {},
    });
    expect(repoCreate).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({ status: "completed", workoutId: null }),
      expect.anything(),
    );
  });

  it("rolls back (no notification) if the audit write throws", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    (auditTrainerAction as any).mockRejectedValue(new Error("audit failed"));

    await expect(logClientSessionOnBehalf(ARGS)).rejects.toThrow(
      "audit failed",
    );
    expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
  });
});
