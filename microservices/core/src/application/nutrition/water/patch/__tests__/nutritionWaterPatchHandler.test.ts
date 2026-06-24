/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const waterMocks = { setCups: vi.fn(), adjust: vi.fn() };
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

function patch(body: unknown, auth = true) {
  return new Request("http://localhost/nutrition/water/today", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

describe("nutritionWaterPatchHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    targetMocks.get.mockResolvedValue({ waterCups: 8 });
  });

  it("requires auth", async () => {
    const { nutritionWaterPatchHandler } =
      await import("../nutritionWaterPatchHandler");
    const res = await nutritionWaterPatchHandler.handle(
      patch({ date: "2026-06-21", cups: 3 }, false),
    );
    expect(res.status).toBe(401);
  });

  it("absolute set via cups (the idempotent replay path)", async () => {
    waterMocks.setCups.mockResolvedValue(3);
    const { nutritionWaterPatchHandler } =
      await import("../nutritionWaterPatchHandler");
    const res = await nutritionWaterPatchHandler.handle(
      patch({ date: "2026-06-21", cups: 3 }),
    );
    expect(res.status).toBe(200);
    expect(waterMocks.setCups).toHaveBeenCalledWith(
      "test-user-id",
      "2026-06-21",
      3,
    );
    expect(((await res.json()) as any).data).toEqual({ cups: 3, goal: 8 });
  });

  it("relative adjust via delta", async () => {
    waterMocks.adjust.mockResolvedValue(4);
    const { nutritionWaterPatchHandler } =
      await import("../nutritionWaterPatchHandler");
    const res = await nutritionWaterPatchHandler.handle(
      patch({ date: "2026-06-21", delta: 1 }),
    );
    expect(res.status).toBe(200);
    expect(waterMocks.adjust).toHaveBeenCalledWith(
      "test-user-id",
      "2026-06-21",
      1,
    );
  });

  it("400s when neither cups nor delta is supplied", async () => {
    const { nutritionWaterPatchHandler } =
      await import("../nutritionWaterPatchHandler");
    const res = await nutritionWaterPatchHandler.handle(
      patch({ date: "2026-06-21" }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("cups_or_delta_required");
  });
});
