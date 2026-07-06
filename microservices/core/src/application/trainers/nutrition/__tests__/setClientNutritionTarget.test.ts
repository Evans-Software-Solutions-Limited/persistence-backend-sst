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

const repoUpsertForClient = vi.fn();
const repoGet = vi.fn();
vi.mock("../../../repositories/nutritionTargetRepository", () => ({
  NutritionTargetRepository: vi.fn(() => ({
    upsertForClient: repoUpsertForClient,
    get: repoGet,
  })),
}));

vi.mock("../../onBehalfNotifications", () => ({
  emitTrainerOnBehalfNotification: vi.fn(async () => {}),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { emitTrainerOnBehalfNotification } from "../../onBehalfNotifications";
import { setClientNutritionTargetOnBehalf } from "../setClientNutritionTarget";

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
  body: {
    dailyKcal: 2200,
    proteinG: 180,
    carbsG: 220,
    fatG: 70,
    waterCups: 10,
  },
};

const DTO = {
  userId: "client-1",
  dailyKcal: 2200,
  proteinG: 180,
  carbsG: 220,
  fatG: 70,
  waterCups: 10,
  preset: "custom",
  setByUserId: "trainer-1",
  setByName: "Coach Bradley",
  updatedAt: null,
};

describe("setClientNutritionTargetOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as any).mockReturnValue(makeDb());
    repoUpsertForClient.mockResolvedValue(undefined);
    repoGet.mockResolvedValue(DTO);
    (auditTrainerAction as any).mockResolvedValue(undefined);
  });

  it("403s with wrong_role when the caller isn't a trainer", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "wrong_role",
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    const result = await setClientNutritionTargetOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    expect(repoUpsertForClient).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("403s with no_relationship when there's no active relationship", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const result = await setClientNutritionTargetOnBehalf(ARGS);
    expect(result.ok).toBe(false);
    expect(repoUpsertForClient).not.toHaveBeenCalled();
  });

  it("happy path: upserts with set_by = trainer, audits in the tx, re-reads DTO, notifies", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    const txStub = { marker: "tx" };
    (getDb as any).mockReturnValue(makeDb(txStub));

    const result = await setClientNutritionTargetOnBehalf(ARGS);

    expect(result).toEqual({ ok: true, target: DTO });
    expect(repoUpsertForClient).toHaveBeenCalledWith(
      "client-1",
      ARGS.body,
      "trainer-1",
      txStub,
    );
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "nutrition_target_set",
        targetTable: "nutrition_targets",
        targetRowId: "client-1",
        payload: ARGS.body,
        tx: txStub,
      }),
    );
    expect(repoGet).toHaveBeenCalledWith("client-1");
    expect(emitTrainerOnBehalfNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "nutrition_target_set_by_trainer",
        deepLink: "/nutrition/targets",
        relatedEntityType: "nutrition_target",
        relatedEntityId: "client-1",
      }),
    );
  });

  it("throws if the post-commit re-read returns null", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    repoGet.mockResolvedValue(null);
    await expect(setClientNutritionTargetOnBehalf(ARGS)).rejects.toThrow(
      "nutrition_target_set_failed",
    );
  });

  it("rolls back (no notification) if the audit write throws", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    (auditTrainerAction as any).mockRejectedValue(new Error("audit failed"));
    await expect(setClientNutritionTargetOnBehalf(ARGS)).rejects.toThrow(
      "audit failed",
    );
    expect(emitTrainerOnBehalfNotification).not.toHaveBeenCalled();
  });
});
