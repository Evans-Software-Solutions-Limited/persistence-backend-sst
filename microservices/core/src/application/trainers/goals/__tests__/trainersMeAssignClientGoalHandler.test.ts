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

const assignClientGoalOnBehalf = vi.fn();
vi.mock("../assignClientGoal", () => ({
  assignClientGoalOnBehalf: (...args: unknown[]) =>
    assignClientGoalOnBehalf(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function post(clientId: string, body: unknown, headers = auth) {
  return new Request(`http://localhost/trainers/me/clients/${clientId}/goals`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("trainersMeAssignClientGoalHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assignClientGoalOnBehalf.mockResolvedValue({
      ok: true,
      goal: { id: "g-1" },
    });
  });

  it("requires auth", async () => {
    const { trainersMeAssignClientGoalHandler } =
      await import("../trainersMeAssignClientGoalHandler");
    const res = await trainersMeAssignClientGoalHandler.handle(
      post("client-1", { goalTypeId: "gt-1" }, {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("maps a denied verdict to its status/body", async () => {
    assignClientGoalOnBehalf.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const { trainersMeAssignClientGoalHandler } =
      await import("../trainersMeAssignClientGoalHandler");
    const res = await trainersMeAssignClientGoalHandler.handle(
      post("client-1", { goalTypeId: "gt-1" }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_your_client");
  });

  it("201s and delegates to the shared core", async () => {
    const { trainersMeAssignClientGoalHandler } =
      await import("../trainersMeAssignClientGoalHandler");
    const res = await trainersMeAssignClientGoalHandler.handle(
      post("client-1", { goalTypeId: "gt-1", notes: "x" }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).data.id).toBe("g-1");
    expect(assignClientGoalOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      body: expect.objectContaining({ goalTypeId: "gt-1" }),
    });
  });
});
