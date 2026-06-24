/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const targetMocks = { get: vi.fn() };

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

const req = (auth = true) =>
  new Request("http://localhost/nutrition/targets", {
    headers: auth ? { authorization: "Bearer token" } : {},
  });

describe("nutritionTargetsGetHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { nutritionTargetsGetHandler } =
      await import("../nutritionTargetsGetHandler");
    expect((await nutritionTargetsGetHandler.handle(req(false))).status).toBe(
      401,
    );
  });

  it("returns the target", async () => {
    targetMocks.get.mockResolvedValue({ dailyKcal: 2200 });
    const { nutritionTargetsGetHandler } =
      await import("../nutritionTargetsGetHandler");
    const res = await nutritionTargetsGetHandler.handle(req());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.dailyKcal).toBe(2200);
  });

  it("returns null when never set", async () => {
    targetMocks.get.mockResolvedValue(null);
    const { nutritionTargetsGetHandler } =
      await import("../nutritionTargetsGetHandler");
    const res = await nutritionTargetsGetHandler.handle(req());
    expect(((await res.json()) as any).data).toBeNull();
  });
});
