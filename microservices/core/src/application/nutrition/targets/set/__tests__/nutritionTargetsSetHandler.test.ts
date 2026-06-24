/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const targetMocks = { upsert: vi.fn() };

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    !h || !h.startsWith("Bearer ")
      ? null
      : { sub: "test-user-id", email: "t@e.com", iat: 0, exp: 9999999999 },
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));
vi.mock("../../../../repositories/nutritionTargetRepository", () => ({
  NutritionTargetRepository: vi.fn().mockImplementation(() => targetMocks),
}));

function put(body: unknown, auth = true) {
  return new Request("http://localhost/nutrition/targets", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

const valid = {
  dailyKcal: 2200,
  proteinG: 170,
  carbsG: 240,
  fatG: 70,
  waterCups: 8,
  preset: "maintain",
};

describe("nutritionTargetsSetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    targetMocks.upsert.mockResolvedValue({ ...valid, userId: "test-user-id" });
  });

  it("requires auth", async () => {
    const { nutritionTargetsSetHandler } =
      await import("../nutritionTargetsSetHandler");
    expect(
      (await nutritionTargetsSetHandler.handle(put(valid, false))).status,
    ).toBe(401);
  });

  it("upserts the target for the user", async () => {
    const { nutritionTargetsSetHandler } =
      await import("../nutritionTargetsSetHandler");
    const res = await nutritionTargetsSetHandler.handle(put(valid));
    expect(res.status).toBe(200);
    expect(targetMocks.upsert).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ dailyKcal: 2200, waterCups: 8 }),
    );
  });
});
