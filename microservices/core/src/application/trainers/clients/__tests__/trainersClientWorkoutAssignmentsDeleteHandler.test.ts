/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "trainer-id",
      email: "t@x.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "trainer-id" }),
}));

const trainerMocks = { isTrainer: vi.fn() };
vi.mock("../../../repositories/trainerService", () => ({
  TrainerService: (elysia: any) =>
    elysia.decorate("TrainerRepository", trainerMocks),
}));

const assignmentMocks = { deleteAdHoc: vi.fn() };
vi.mock("../../../repositories/programService", () => ({
  ProgramService: (elysia: any) =>
    elysia.decorate("ProgramAssignmentRepository", assignmentMocks),
}));

const auditTrainerAction = vi.fn();
vi.mock("../../../relationships/auditTrainerAction", () => ({
  auditTrainerAction: (...args: unknown[]) => auditTrainerAction(...args),
}));

function makeDb(txStub: unknown = {}) {
  return {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(txStub),
    ),
  };
}
const getDbMock = vi.fn();
vi.mock("@persistence/db/client", () => ({
  getDb: (...args: unknown[]) => getDbMock(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function del(clientId: string, id: string, headers = auth) {
  return new Request(
    `http://localhost/trainers/me/clients/${clientId}/workout-assignments/${id}`,
    { method: "DELETE", headers },
  );
}

describe("trainersClientWorkoutAssignmentsDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trainerMocks.isTrainer.mockResolvedValue(true);
    getDbMock.mockReturnValue(makeDb());
  });

  it("requires auth", async () => {
    const { trainersClientWorkoutAssignmentsDeleteHandler } =
      await import("../trainersClientWorkoutAssignmentsDeleteHandler");
    const res = await trainersClientWorkoutAssignmentsDeleteHandler.handle(
      del("client-1", "wa-1", {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("403s when the caller isn't a trainer, before touching the repo/tx", async () => {
    trainerMocks.isTrainer.mockResolvedValue(false);
    const { trainersClientWorkoutAssignmentsDeleteHandler } =
      await import("../trainersClientWorkoutAssignmentsDeleteHandler");
    const res = await trainersClientWorkoutAssignmentsDeleteHandler.handle(
      del("client-1", "wa-1"),
    );
    expect(res.status).toBe(403);
    expect(assignmentMocks.deleteAdHoc).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("404s when the assignment isn't found, writing no audit row", async () => {
    assignmentMocks.deleteAdHoc.mockResolvedValue({ result: "not_found" });
    const { trainersClientWorkoutAssignmentsDeleteHandler } =
      await import("../trainersClientWorkoutAssignmentsDeleteHandler");
    const res = await trainersClientWorkoutAssignmentsDeleteHandler.handle(
      del("client-1", "wa-x"),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).code).toBe("not_found");
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("409s when the assignment exists but isn't deletable, writing no audit row", async () => {
    assignmentMocks.deleteAdHoc.mockResolvedValue({ result: "not_deletable" });
    const { trainersClientWorkoutAssignmentsDeleteHandler } =
      await import("../trainersClientWorkoutAssignmentsDeleteHandler");
    const res = await trainersClientWorkoutAssignmentsDeleteHandler.handle(
      del("client-1", "wa-1"),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe("not_deletable");
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("200s on delete, writing the audit row inside the same tx as the delete", async () => {
    const txStub = { marker: "tx" };
    getDbMock.mockReturnValue(makeDb(txStub));
    assignmentMocks.deleteAdHoc.mockResolvedValue({
      result: "deleted",
      assignment: { id: "wa-1", workoutId: "w-1", dueDate: "2026-07-10" },
    });
    const { trainersClientWorkoutAssignmentsDeleteHandler } =
      await import("../trainersClientWorkoutAssignmentsDeleteHandler");
    const res = await trainersClientWorkoutAssignmentsDeleteHandler.handle(
      del("client-1", "wa-1"),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toEqual({ deleted: true });

    expect(assignmentMocks.deleteAdHoc).toHaveBeenCalledWith(
      "trainer-id",
      "client-1",
      "wa-1",
      txStub,
    );
    expect(auditTrainerAction).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      actionType: "workout_unassigned",
      targetTable: "workout_assignments",
      targetRowId: "wa-1",
      payload: { workoutId: "w-1", dueDate: "2026-07-10" },
      tx: txStub,
    });
  });

  it("rolls back the delete (404 mapping never applies) if the audit insert throws", async () => {
    assignmentMocks.deleteAdHoc.mockResolvedValue({
      result: "deleted",
      assignment: { id: "wa-1", workoutId: "w-1", dueDate: null },
    });
    auditTrainerAction.mockRejectedValue(new Error("audit failed"));
    const { trainersClientWorkoutAssignmentsDeleteHandler } =
      await import("../trainersClientWorkoutAssignmentsDeleteHandler");
    const res = await trainersClientWorkoutAssignmentsDeleteHandler.handle(
      del("client-1", "wa-1"),
    );
    // The transaction rejects; Elysia's default error mapping returns 500 —
    // the point under test is that we never reach the 200 success response,
    // i.e. the audit failure isn't swallowed and the delete isn't reported
    // as having succeeded.
    expect(res.status).not.toBe(200);
  });
});
