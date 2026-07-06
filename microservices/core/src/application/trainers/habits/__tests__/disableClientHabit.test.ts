/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: vi.fn(),
}));
vi.mock("../../../relationships/auditTrainerAction", () => ({
  auditTrainerAction: vi.fn(),
}));

const repoDisable = vi.fn();
const repoGetAssigner = vi.fn();
vi.mock("../../../repositories/habitConfigRepository", () => ({
  HabitConfigRepository: vi.fn(() => ({
    disable: repoDisable,
    getAssigner: repoGetAssigner,
  })),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { disableClientHabitOnBehalf } from "../disableClientHabit";

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
  category: "water",
};

beforeEach(() => {
  vi.clearAllMocks();
  (getDb as any).mockReturnValue(makeDb());
  (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
  (auditTrainerAction as any).mockResolvedValue(undefined);
  repoGetAssigner.mockResolvedValue({
    goalId: "g1",
    assignedByUserId: "trainer-1",
  });
  repoDisable.mockResolvedValue("g1");
});

describe("disableClientHabitOnBehalf (T-18.3.1)", () => {
  it("404s an unknown category", async () => {
    const r = await disableClientHabitOnBehalf({ ...ARGS, category: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("403s when the gate denies", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      status: 403,
      body: { code: "not_your_client", message: "no" },
    });
    const r = await disableClientHabitOnBehalf(ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(repoDisable).not.toHaveBeenCalled();
  });

  it("403s a self-set (unassigned) habit — a coach can't disable it", async () => {
    repoGetAssigner.mockResolvedValue({ goalId: "g1", assignedByUserId: null });
    const r = await disableClientHabitOnBehalf(ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(repoDisable).not.toHaveBeenCalled();
  });

  it("403s a habit assigned by a DIFFERENT coach", async () => {
    repoGetAssigner.mockResolvedValue({
      goalId: "g1",
      assignedByUserId: "other",
    });
    const r = await disableClientHabitOnBehalf(ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("disables its own habit + audits in one tx", async () => {
    const r = await disableClientHabitOnBehalf(ARGS);
    expect(r.ok).toBe(true);
    expect(repoDisable).toHaveBeenCalledWith(
      "client-1",
      "water",
      expect.objectContaining({ tx: expect.anything() }),
    );
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "goal_assigned",
        targetRowId: "g1",
        payload: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it("404s when the habit wasn't active to disable", async () => {
    repoDisable.mockResolvedValue(null);
    const r = await disableClientHabitOnBehalf(ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});
