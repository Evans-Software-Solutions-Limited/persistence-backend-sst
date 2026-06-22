/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const entryMocks = { listByDate: vi.fn() };
const targetMocks = { get: vi.fn() };
const waterMocks = { getCups: vi.fn() };

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
vi.mock("../../../repositories/nutritionEntryRepository", () => ({
  NutritionEntryRepository: vi.fn().mockImplementation(() => entryMocks),
}));
vi.mock("../../../repositories/nutritionTargetRepository", () => ({
  NutritionTargetRepository: vi.fn().mockImplementation(() => targetMocks),
}));
vi.mock("../../../repositories/waterLogRepository", () => ({
  WaterLogRepository: vi.fn().mockImplementation(() => waterMocks),
}));

function entry(slot: string, kcal: number): any {
  return {
    id: `${slot}-${kcal}`,
    mealSlot: slot,
    kcal,
    proteinG: 10,
    carbsG: 20,
    fatG: 5,
  };
}

describe("summariseConsumed / groupBySlot (pure)", () => {
  it("sums macros across entries", async () => {
    const { summariseConsumed } = await import("../nutritionTodayHandler");
    const out = summariseConsumed([
      entry("breakfast", 300),
      entry("lunch", 200),
    ]);
    expect(out).toEqual({ kcal: 500, proteinG: 20, carbsG: 40, fatG: 10 });
  });

  it("returns zeroes for an empty day", async () => {
    const { summariseConsumed } = await import("../nutritionTodayHandler");
    expect(summariseConsumed([])).toEqual({
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it("groups entries into the four fixed slots", async () => {
    const { groupBySlot } = await import("../nutritionTodayHandler");
    const out = groupBySlot([entry("breakfast", 1), entry("dinner", 2)]);
    expect(out.breakfast).toHaveLength(1);
    expect(out.dinner).toHaveLength(1);
    expect(out.lunch).toEqual([]);
    expect(out.snack).toEqual([]);
  });
});

describe("nutritionTodayHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entryMocks.listByDate.mockResolvedValue([entry("breakfast", 300)]);
    targetMocks.get.mockResolvedValue({ dailyKcal: 2000, waterCups: 8 });
    waterMocks.getCups.mockResolvedValue(4);
  });

  it("requires auth", async () => {
    const { nutritionTodayHandler } = await import("../nutritionTodayHandler");
    const res = await nutritionTodayHandler.handle(
      new Request("http://localhost/nutrition/today?date=2026-06-21"),
    );
    expect(res.status).toBe(401);
  });

  it("returns the day aggregate with remainingKcal and water", async () => {
    const { nutritionTodayHandler } = await import("../nutritionTodayHandler");
    const res = await nutritionTodayHandler.handle(
      new Request("http://localhost/nutrition/today?date=2026-06-21", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.consumed.kcal).toBe(300);
    expect(body.data.consumed.waterCups).toBe(4);
    expect(body.data.remainingKcal).toBe(1700);
    expect(body.data.entriesBySlot.breakfast).toHaveLength(1);
  });

  it("remainingKcal is 0 when no target is set", async () => {
    targetMocks.get.mockResolvedValue(null);
    const { nutritionTodayHandler } = await import("../nutritionTodayHandler");
    const res = await nutritionTodayHandler.handle(
      new Request("http://localhost/nutrition/today?date=2026-06-21", {
        headers: { authorization: "Bearer token" },
      }),
    );
    const body = (await res.json()) as any;
    expect(body.data.remainingKcal).toBe(0);
    expect(body.data.targets).toBeNull();
  });
});
