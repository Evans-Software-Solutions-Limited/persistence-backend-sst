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

const assignClientWorkoutOnBehalf = vi.fn();
vi.mock("../assignClientWorkout", () => ({
  assignClientWorkoutOnBehalf: (...args: unknown[]) =>
    assignClientWorkoutOnBehalf(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function post(clientId: string, body: unknown, headers = auth) {
  return new Request(
    `http://localhost/trainers/me/clients/${clientId}/workout-assignments`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
}

describe("trainersClientWorkoutAssignmentsCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assignClientWorkoutOnBehalf.mockResolvedValue({
      ok: true,
      assignment: { id: "wa-1" },
    });
  });

  it("requires auth", async () => {
    const { trainersClientWorkoutAssignmentsCreateHandler } =
      await import("../trainersClientWorkoutAssignmentsCreateHandler");
    const res = await trainersClientWorkoutAssignmentsCreateHandler.handle(
      post("client-1", { workoutId: "w-1" }, {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("maps a denied verdict to its status/body", async () => {
    assignClientWorkoutOnBehalf.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const { trainersClientWorkoutAssignmentsCreateHandler } =
      await import("../trainersClientWorkoutAssignmentsCreateHandler");
    const res = await trainersClientWorkoutAssignmentsCreateHandler.handle(
      post("client-1", { workoutId: "w-1" }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_your_client");
  });

  it("maps a 422 (invalid workout) verdict", async () => {
    assignClientWorkoutOnBehalf.mockResolvedValue({
      ok: false,
      status: 422,
      body: { code: "invalid_workout", message: "x" },
    });
    const { trainersClientWorkoutAssignmentsCreateHandler } =
      await import("../trainersClientWorkoutAssignmentsCreateHandler");
    const res = await trainersClientWorkoutAssignmentsCreateHandler.handle(
      post("client-1", { workoutId: "w-1" }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).code).toBe("invalid_workout");
  });

  it("201s and delegates to the shared core", async () => {
    const { trainersClientWorkoutAssignmentsCreateHandler } =
      await import("../trainersClientWorkoutAssignmentsCreateHandler");
    const res = await trainersClientWorkoutAssignmentsCreateHandler.handle(
      post("client-1", { workoutId: "w-1" }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).data.id).toBe("wa-1");
    expect(assignClientWorkoutOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      body: expect.objectContaining({ workoutId: "w-1" }),
    });
  });
});
