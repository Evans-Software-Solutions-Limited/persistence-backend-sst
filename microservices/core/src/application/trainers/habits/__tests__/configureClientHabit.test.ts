/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: vi.fn(),
}));
vi.mock("../../../relationships/auditTrainerAction", () => ({
  auditTrainerAction: vi.fn(),
}));

const repoUpsert = vi.fn();
const repoGetAssigner = vi.fn();
vi.mock("../../../repositories/habitConfigRepository", () => ({
  HabitConfigRepository: vi.fn(() => ({
    upsert: repoUpsert,
    getAssigner: repoGetAssigner,
  })),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { configureClientHabitOnBehalf } from "../configureClientHabit";

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
  body: { targetValue: 2.5, daysPerWeek: 5 },
};

beforeEach(() => {
  vi.clearAllMocks();
  (getDb as any).mockReturnValue(makeDb());
  (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
  (auditTrainerAction as any).mockResolvedValue(undefined);
  repoGetAssigner.mockResolvedValue({ goalId: "g1", assignedByUserId: null });
  repoUpsert.mockResolvedValue({ goalId: "g1", category: "water" });
});

describe("configureClientHabitOnBehalf (T-18.3.1)", () => {
  it("404s an unknown category before touching auth", async () => {
    const r = await configureClientHabitOnBehalf({ ...ARGS, category: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
    expect(assertTrainerCanActForClient).not.toHaveBeenCalled();
  });

  it("403s when the gate denies (wrong role / no relationship)", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      status: 403,
      body: { code: "not_your_client", message: "no" },
    });
    const r = await configureClientHabitOnBehalf(ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(repoUpsert).not.toHaveBeenCalled();
  });

  it("403s when the habit was assigned by a DIFFERENT coach", async () => {
    repoGetAssigner.mockResolvedValue({
      goalId: "g1",
      assignedByUserId: "other-coach",
    });
    const r = await configureClientHabitOnBehalf(ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(repoUpsert).not.toHaveBeenCalled();
  });

  it("422s an out-of-bounds target", async () => {
    const r = await configureClientHabitOnBehalf({
      ...ARGS,
      body: { targetValue: 999 }, // water max is 20
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });

  it("stamps assigned_by_user_id + writes a goal_assigned audit in one tx", async () => {
    const r = await configureClientHabitOnBehalf(ARGS);
    expect(r.ok).toBe(true);
    // upsert ran with the trainer id + the tx handle.
    expect(repoUpsert).toHaveBeenCalledWith(
      "client-1",
      "water",
      expect.objectContaining({ targetValue: 2.5, daysPerWeek: 5 }),
      expect.objectContaining({ assignedByUserId: "trainer-1" }),
    );
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        trainerId: "trainer-1",
        clientId: "client-1",
        actionType: "goal_assigned",
        targetTable: "user_goals",
        targetRowId: "g1",
      }),
    );
  });

  it("allows a coach to take over a SELF-set (unassigned) habit", async () => {
    repoGetAssigner.mockResolvedValue({ goalId: "g1", assignedByUserId: null });
    const r = await configureClientHabitOnBehalf(ARGS);
    expect(r.ok).toBe(true);
  });

  it("allows a coach to re-edit its OWN habit", async () => {
    repoGetAssigner.mockResolvedValue({
      goalId: "g1",
      assignedByUserId: "trainer-1",
    });
    const r = await configureClientHabitOnBehalf(ARGS);
    expect(r.ok).toBe(true);
  });

  it("404s when the upsert can't resolve the goal type", async () => {
    repoUpsert.mockResolvedValue(null);
    const r = await configureClientHabitOnBehalf(ARGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});
