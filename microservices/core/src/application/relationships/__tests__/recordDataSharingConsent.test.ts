/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

import { recordDataSharingConsent } from "../recordDataSharingConsent";
import { dataSharingConsents } from "@persistence/db";

/**
 * A minimal Drizzle-transaction stub: `tx.insert(table).values(row)`.
 * `values` resolves (or rejects) so we can prove both the happy write and
 * the failure-propagation (which is what makes the caller's transaction roll
 * back — mirrors auditTrainerAction.test.ts).
 */
function makeTx(valuesImpl: (row: unknown) => Promise<unknown>) {
  const values = vi.fn(valuesImpl);
  const insert = vi.fn(() => ({ values }));
  return { insert, values } as any;
}

const GRANT_ARGS = {
  trainerId: "trainer-1",
  clientId: "client-1",
  action: "grant" as const,
  consentVersion: "v1-2026-07",
  source: "invite_accept" as const,
};

describe("recordDataSharingConsent", () => {
  it("inserts one grant row into data_sharing_consents on the passed tx", async () => {
    const tx = makeTx(() => Promise.resolve(undefined));

    await recordDataSharingConsent({ ...GRANT_ARGS, tx });

    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledWith(dataSharingConsents);
    expect(tx.values).toHaveBeenCalledWith({
      trainerId: "trainer-1",
      clientId: "client-1",
      action: "grant",
      consentVersion: "v1-2026-07",
      source: "invite_accept",
    });
  });

  it("inserts a withdraw row with the given source", async () => {
    const tx = makeTx(() => Promise.resolve(undefined));

    await recordDataSharingConsent({
      trainerId: "trainer-1",
      clientId: "client-1",
      action: "withdraw",
      consentVersion: "v1-2026-07",
      source: "coach_removed",
      tx,
    });

    expect(tx.values).toHaveBeenCalledWith(
      expect.objectContaining({ action: "withdraw", source: "coach_removed" }),
    );
  });

  it("propagates the insert error so the caller's transaction rolls back", async () => {
    const boom = new Error("consent insert failed");
    const tx = makeTx(() => Promise.reject(boom));

    await expect(
      recordDataSharingConsent({ ...GRANT_ARGS, tx }),
    ).rejects.toThrow("consent insert failed");
  });
});
