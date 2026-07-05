/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: vi.fn(),
}));

const repoGetById = vi.fn();
const repoUpdate = vi.fn();
vi.mock("../../../repositories/goalRepository", () => ({
  GoalRepository: vi.fn(() => ({ getById: repoGetById, update: repoUpdate })),
}));

import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { updateClientGoalOnBehalf } from "../updateClientGoal";

const ARGS = {
  trainerId: "trainer-1",
  clientId: "client-1",
  goalId: "g-1",
  body: { notes: "updated", priority: 2 },
};

describe("updateClientGoalOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    repoGetById.mockResolvedValue({
      id: "g-1",
      userId: "client-1",
      assignedByUserId: "trainer-1",
    });
    repoUpdate.mockResolvedValue({
      id: "g-1",
      userId: "client-1",
      assignedByUserId: "trainer-1",
      notes: "updated",
      priority: 2,
    });
  });

  it("403s when the caller isn't a trainer / has no relationship", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "wrong_role",
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    const result = await updateClientGoalOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    expect(repoGetById).not.toHaveBeenCalled();
    expect(repoUpdate).not.toHaveBeenCalled();
  });

  it("404s when the goal does not exist for the client", async () => {
    repoGetById.mockResolvedValue(null);
    const result = await updateClientGoalOnBehalf(ARGS);
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(repoUpdate).not.toHaveBeenCalled();
  });

  it("403 not_assigner when the goal was assigned by a different trainer", async () => {
    repoGetById.mockResolvedValue({
      id: "g-1",
      userId: "client-1",
      assignedByUserId: "other-trainer",
    });
    const result = await updateClientGoalOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 403,
      body: {
        code: "not_assigner",
        message: "You can only edit goals you assigned",
      },
    });
    expect(repoUpdate).not.toHaveBeenCalled();
  });

  it("403 not_assigner when the goal is self-set (assigned_by is null)", async () => {
    repoGetById.mockResolvedValue({
      id: "g-1",
      userId: "client-1",
      assignedByUserId: null,
    });
    const result = await updateClientGoalOnBehalf(ARGS);
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(repoUpdate).not.toHaveBeenCalled();
  });

  it("400 when no editable fields are supplied", async () => {
    const result = await updateClientGoalOnBehalf({
      ...ARGS,
      body: {},
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(repoUpdate).not.toHaveBeenCalled();
  });

  it("happy path: the assigning trainer edits whitelisted fields (no audit)", async () => {
    const result = await updateClientGoalOnBehalf(ARGS);
    expect(result).toEqual({
      ok: true,
      goal: expect.objectContaining({ id: "g-1", notes: "updated" }),
    });
    expect(repoUpdate).toHaveBeenCalledWith("g-1", "client-1", {
      notes: "updated",
      priority: 2,
    });
  });

  it("404 when the goal is raced away between load and update", async () => {
    repoUpdate.mockResolvedValue(null);
    const result = await updateClientGoalOnBehalf(ARGS);
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});
