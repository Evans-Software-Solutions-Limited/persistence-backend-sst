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

const swapClientWorkoutOnBehalf = vi.fn();
vi.mock("../swapClientWorkout", () => ({
  swapClientWorkoutOnBehalf: (...args: unknown[]) =>
    swapClientWorkoutOnBehalf(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function patch(clientId: string, id: string, body: unknown, headers = auth) {
  return new Request(
    `http://localhost/trainers/me/clients/${clientId}/workout-assignments/${id}`,
    { method: "PATCH", headers, body: JSON.stringify(body) },
  );
}

describe("trainersClientWorkoutAssignmentsSwapHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swapClientWorkoutOnBehalf.mockResolvedValue({
      ok: true,
      assignment: { id: "wa-1", workoutId: "w-new" },
    });
  });

  it("requires auth", async () => {
    const { trainersClientWorkoutAssignmentsSwapHandler } =
      await import("../trainersClientWorkoutAssignmentsSwapHandler");
    const res = await trainersClientWorkoutAssignmentsSwapHandler.handle(
      patch("client-1", "wa-1", { workoutId: "w-new" }, {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("maps a 409 not_swappable verdict", async () => {
    swapClientWorkoutOnBehalf.mockResolvedValue({
      ok: false,
      status: 409,
      body: { code: "not_swappable", message: "x" },
    });
    const { trainersClientWorkoutAssignmentsSwapHandler } =
      await import("../trainersClientWorkoutAssignmentsSwapHandler");
    const res = await trainersClientWorkoutAssignmentsSwapHandler.handle(
      patch("client-1", "wa-1", { workoutId: "w-new" }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe("not_swappable");
  });

  it("200s and delegates to the shared core with params + body threaded through", async () => {
    const { trainersClientWorkoutAssignmentsSwapHandler } =
      await import("../trainersClientWorkoutAssignmentsSwapHandler");
    const res = await trainersClientWorkoutAssignmentsSwapHandler.handle(
      patch("client-1", "wa-1", { workoutId: "w-new" }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.id).toBe("wa-1");
    expect(swapClientWorkoutOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      assignmentId: "wa-1",
      body: { workoutId: "w-new" },
    });
  });
});
