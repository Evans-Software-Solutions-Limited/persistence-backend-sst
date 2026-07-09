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

vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: vi.fn(),
}));

const listOpen = vi.fn();
vi.mock("../../../repositories/programAssignmentRepository", () => ({
  ProgramAssignmentRepository: vi.fn(() => ({
    listOpenAssignmentsForClient: listOpen,
  })),
}));

import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";

const auth = { authorization: "Bearer token" };

function get(clientId: string, headers: Record<string, string> = auth) {
  return new Request(
    `http://localhost/trainers/me/clients/${clientId}/workout-assignments`,
    { method: "GET", headers },
  );
}

describe("trainersClientWorkoutAssignmentsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    listOpen.mockResolvedValue([
      {
        assignmentId: "wa-1",
        workoutId: "w-1",
        name: "Push",
        status: "assigned",
      },
    ]);
  });

  it("requires auth", async () => {
    const { trainersClientWorkoutAssignmentsListHandler } =
      await import("../trainersClientWorkoutAssignmentsListHandler");
    const res = await trainersClientWorkoutAssignmentsListHandler.handle(
      get("client-1", {}),
    );
    expect(res.status).toBe(401);
  });

  it("403s a denied verdict without reading", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const { trainersClientWorkoutAssignmentsListHandler } =
      await import("../trainersClientWorkoutAssignmentsListHandler");
    const res = await trainersClientWorkoutAssignmentsListHandler.handle(
      get("client-1"),
    );
    expect(res.status).toBe(403);
    expect(listOpen).not.toHaveBeenCalled();
  });

  it("returns the client's open assignments scoped to the trainer", async () => {
    const { trainersClientWorkoutAssignmentsListHandler } =
      await import("../trainersClientWorkoutAssignmentsListHandler");
    const res = await trainersClientWorkoutAssignmentsListHandler.handle(
      get("client-1"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.assignments).toHaveLength(1);
    expect(body.data.assignments[0].assignmentId).toBe("wa-1");
    expect(listOpen).toHaveBeenCalledWith("trainer-id", "client-1");
  });
});
