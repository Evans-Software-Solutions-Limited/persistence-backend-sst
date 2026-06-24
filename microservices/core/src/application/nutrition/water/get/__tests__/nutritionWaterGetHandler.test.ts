/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const waterMocks = { getCups: vi.fn() };
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
vi.mock("../../../../repositories/waterLogRepository", () => ({
  WaterLogRepository: vi.fn().mockImplementation(() => waterMocks),
}));
vi.mock("../../../../repositories/nutritionTargetRepository", () => ({
  NutritionTargetRepository: vi.fn().mockImplementation(() => targetMocks),
}));

const req = (auth = true) =>
  new Request("http://localhost/nutrition/water/today?date=2026-06-21", {
    headers: auth ? { authorization: "Bearer token" } : {},
  });

describe("nutritionWaterGetHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { nutritionWaterGetHandler } =
      await import("../nutritionWaterGetHandler");
    expect((await nutritionWaterGetHandler.handle(req(false))).status).toBe(
      401,
    );
  });

  it("returns cups + the target's water goal", async () => {
    waterMocks.getCups.mockResolvedValue(5);
    targetMocks.get.mockResolvedValue({ waterCups: 10 });
    const { nutritionWaterGetHandler } =
      await import("../nutritionWaterGetHandler");
    const res = await nutritionWaterGetHandler.handle(req());
    const body = (await res.json()) as any;
    expect(body.data).toEqual({ cups: 5, goal: 10 });
  });

  it("defaults the goal to 8 when no target", async () => {
    waterMocks.getCups.mockResolvedValue(0);
    targetMocks.get.mockResolvedValue(null);
    const { nutritionWaterGetHandler } =
      await import("../nutritionWaterGetHandler");
    const res = await nutritionWaterGetHandler.handle(req());
    expect(((await res.json()) as any).data.goal).toBe(8);
  });
});
