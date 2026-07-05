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

const setClientNutritionTargetOnBehalf = vi.fn();
vi.mock("../setClientNutritionTarget", () => ({
  setClientNutritionTargetOnBehalf: (...args: unknown[]) =>
    setClientNutritionTargetOnBehalf(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function put(clientId: string, body: unknown, headers = auth) {
  return new Request(
    `http://localhost/trainers/me/clients/${clientId}/nutrition/target`,
    { method: "PUT", headers, body: JSON.stringify(body) },
  );
}

const successBody = {
  dailyKcal: 2200,
  proteinG: 180,
  carbsG: 220,
  fatG: 70,
  waterCups: 10,
};

describe("trainersMeSetClientNutritionTargetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setClientNutritionTargetOnBehalf.mockResolvedValue({
      ok: true,
      target: { userId: "client-1", dailyKcal: 2200 },
    });
  });

  it("requires auth", async () => {
    const { trainersMeSetClientNutritionTargetHandler } =
      await import("../trainersMeSetClientNutritionTargetHandler");
    const res = await trainersMeSetClientNutritionTargetHandler.handle(
      put("client-1", successBody, {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("maps a denied verdict to its status/body", async () => {
    setClientNutritionTargetOnBehalf.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const { trainersMeSetClientNutritionTargetHandler } =
      await import("../trainersMeSetClientNutritionTargetHandler");
    const res = await trainersMeSetClientNutritionTargetHandler.handle(
      put("client-1", successBody),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_your_client");
  });

  it("200s and delegates to the shared core", async () => {
    const { trainersMeSetClientNutritionTargetHandler } =
      await import("../trainersMeSetClientNutritionTargetHandler");
    const res = await trainersMeSetClientNutritionTargetHandler.handle(
      put("client-1", successBody),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.dailyKcal).toBe(2200);
    expect(setClientNutritionTargetOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      body: expect.objectContaining({ dailyKcal: 2200 }),
    });
  });
});
