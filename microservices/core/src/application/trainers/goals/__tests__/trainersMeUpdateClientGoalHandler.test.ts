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

const updateClientGoalOnBehalf = vi.fn();
vi.mock("../updateClientGoal", () => ({
  updateClientGoalOnBehalf: (...args: unknown[]) =>
    updateClientGoalOnBehalf(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function put(clientId: string, id: string, body: unknown, headers = auth) {
  return new Request(
    `http://localhost/trainers/me/clients/${clientId}/goals/${id}`,
    { method: "PUT", headers, body: JSON.stringify(body) },
  );
}

describe("trainersMeUpdateClientGoalHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateClientGoalOnBehalf.mockResolvedValue({
      ok: true,
      goal: { id: "g-1", notes: "updated" },
    });
  });

  it("requires auth", async () => {
    const { trainersMeUpdateClientGoalHandler } =
      await import("../trainersMeUpdateClientGoalHandler");
    const res = await trainersMeUpdateClientGoalHandler.handle(
      put("client-1", "g-1", { notes: "updated" }, {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("maps a denied verdict to its status/body", async () => {
    updateClientGoalOnBehalf.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_assigner", message: "x" },
    });
    const { trainersMeUpdateClientGoalHandler } =
      await import("../trainersMeUpdateClientGoalHandler");
    const res = await trainersMeUpdateClientGoalHandler.handle(
      put("client-1", "g-1", { notes: "updated" }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_assigner");
  });

  it("maps a 404 (goal not found) verdict", async () => {
    updateClientGoalOnBehalf.mockResolvedValue({
      ok: false,
      status: 404,
      body: { code: "goal_not_found", message: "x" },
    });
    const { trainersMeUpdateClientGoalHandler } =
      await import("../trainersMeUpdateClientGoalHandler");
    const res = await trainersMeUpdateClientGoalHandler.handle(
      put("client-1", "g-1", { notes: "updated" }),
    );
    expect(res.status).toBe(404);
  });

  it("200s and delegates to the shared core", async () => {
    const { trainersMeUpdateClientGoalHandler } =
      await import("../trainersMeUpdateClientGoalHandler");
    const res = await trainersMeUpdateClientGoalHandler.handle(
      put("client-1", "g-1", { notes: "updated", priority: 2 }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.id).toBe("g-1");
    expect(updateClientGoalOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      goalId: "g-1",
      body: expect.objectContaining({ notes: "updated" }),
    });
  });
});
