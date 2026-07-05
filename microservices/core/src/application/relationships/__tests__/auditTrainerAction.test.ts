/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

import { auditTrainerAction } from "../auditTrainerAction";
import { trainerActionsAudit } from "@persistence/db";

/**
 * A minimal Drizzle-transaction stub: `tx.insert(table).values(row)`.
 * `values` resolves (or rejects) so we can prove both the happy write and
 * the failure-propagation (which is what makes the caller's transaction roll
 * back — cross-cuts § 1.4.2).
 */
function makeTx(valuesImpl: (row: unknown) => Promise<unknown>) {
  const values = vi.fn(valuesImpl);
  const insert = vi.fn(() => ({ values }));
  return { insert, values } as any;
}

const ARGS = {
  trainerId: "trainer-1",
  clientId: "client-1",
  actionType: "measurement_logged_on_behalf" as const,
  targetTable: "body_measurements",
  targetRowId: "row-1",
  payload: { weightKg: "80.5" },
};

describe("auditTrainerAction", () => {
  it("inserts one audit row into trainer_actions_audit on the passed tx", async () => {
    const tx = makeTx(() => Promise.resolve(undefined));

    await auditTrainerAction({ ...ARGS, tx });

    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledWith(trainerActionsAudit);
    expect(tx.values).toHaveBeenCalledWith({
      trainerId: "trainer-1",
      clientId: "client-1",
      actionType: "measurement_logged_on_behalf",
      targetTable: "body_measurements",
      targetRowId: "row-1",
      payload: { weightKg: "80.5" },
    });
  });

  it("propagates the insert error so the caller's transaction rolls back", async () => {
    const boom = new Error("audit insert failed");
    const tx = makeTx(() => Promise.reject(boom));

    await expect(auditTrainerAction({ ...ARGS, tx })).rejects.toThrow(
      "audit insert failed",
    );
  });
});
