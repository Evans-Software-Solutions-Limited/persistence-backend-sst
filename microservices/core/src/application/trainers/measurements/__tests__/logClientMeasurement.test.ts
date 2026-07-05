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

vi.mock("../../../streaks/evaluate", () => ({
  safeEvaluateStreaks: vi.fn(async () => {}),
}));

const repoCreate = vi.fn();
vi.mock("../../../repositories/measurementRepository", () => ({
  MeasurementRepository: vi.fn(() => ({ create: repoCreate })),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { safeEvaluateStreaks } from "../../../streaks/evaluate";
import { logClientMeasurementOnBehalf } from "../logClientMeasurement";

/** A minimal `db.transaction(async (tx) => ...)` stub — `tx` is opaque here
 * since the repo + audit calls are mocked; we only need `transaction` to
 * invoke the callback and propagate rejection. */
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
  body: { weightKg: 80.5, notes: "note" },
};

describe("logClientMeasurementOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as any).mockReturnValue(makeDb());
    repoCreate.mockResolvedValue({
      id: "m-1",
      userId: "client-1",
      loggedByUserId: "trainer-1",
      weightKg: "80.5",
      measuredAt: new Date(),
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

    const result = await logClientMeasurementOnBehalf(ARGS);

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

    const result = await logClientMeasurementOnBehalf(ARGS);

    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    expect(repoCreate).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("happy path: creates the measurement, audits inside the tx, advances the streak, returns ok", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: true,
    });
    const txStub = { marker: "tx" };
    (getDb as any).mockReturnValue(makeDb(txStub));

    const result = await logClientMeasurementOnBehalf(ARGS);

    expect(result).toEqual({
      ok: true,
      measurement: expect.objectContaining({ id: "m-1" }),
    });

    // Measurement created for the CLIENT, stamped with the trainer, on the tx.
    expect(repoCreate).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({
        loggedByUserId: "trainer-1",
        weightKg: "80.5",
        notes: "note",
      }),
      txStub,
    );

    // Audit written inside the SAME transaction handle, after the measurement
    // id is known, before the transaction resolves.
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        trainerId: "trainer-1",
        clientId: "client-1",
        actionType: "measurement_logged_on_behalf",
        targetTable: "body_measurements",
        targetRowId: "m-1",
        payload: ARGS.body,
        tx: txStub,
      }),
    );

    // Streak advance happens after commit, error-tolerant.
    expect(safeEvaluateStreaks).toHaveBeenCalledWith(
      "client-1",
      "measurement_logged",
      expect.any(Date),
    );
  });

  it("rolls back the transaction (no measurement persisted) if the audit write throws", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: true,
    });
    const boom = new Error("audit insert failed");
    (auditTrainerAction as any).mockRejectedValue(boom);

    await expect(logClientMeasurementOnBehalf(ARGS)).rejects.toThrow(
      "audit insert failed",
    );

    // The streak side-effect only runs after a successful commit.
    expect(safeEvaluateStreaks).not.toHaveBeenCalled();
  });
});
