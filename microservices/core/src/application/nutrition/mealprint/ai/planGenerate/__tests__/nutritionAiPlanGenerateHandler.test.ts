/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const usageMocks = vi.hoisted(() => ({
  countForUserToday: vi.fn(),
  record: vi.fn(),
}));
const targetMocks = vi.hoisted(() => ({ get: vi.fn() }));
const prefMocks = vi.hoisted(() => ({ get: vi.fn() }));
const candidateMocks = vi.hoisted(() => ({
  listCuratedCandidates: vi.fn(),
  listOwnFoodCandidates: vi.fn(),
  listOwnRecipeCandidates: vi.fn(),
  listOwnMealCandidates: vi.fn(),
}));
const assertEntitlementMock = vi.hoisted(() => vi.fn());
const composeDayPlanMock = vi.hoisted(() => vi.fn());

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

vi.mock("../../../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../entitlement/assertEntitlement")
  >("../../../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: assertEntitlementMock };
});
vi.mock("../../../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn().mockImplementation(() => usageMocks),
}));
vi.mock("../../../../../repositories/nutritionTargetRepository", () => ({
  NutritionTargetRepository: vi.fn().mockImplementation(() => targetMocks),
}));
vi.mock("../../../../../repositories/nutritionPreferenceRepository", () => ({
  NutritionPreferenceRepository: vi.fn().mockImplementation(() => prefMocks),
}));
vi.mock(
  "../../../../../repositories/mealprintCandidateRepository",
  async () => {
    const actual = await vi.importActual<
      typeof import("../../../../../repositories/mealprintCandidateRepository")
    >("../../../../../repositories/mealprintCandidateRepository");
    return {
      ...actual,
      MealprintCandidateRepository: vi
        .fn()
        .mockImplementation(() => candidateMocks),
    };
  },
);
vi.mock("../../planModel", async () => {
  const actual =
    await vi.importActual<typeof import("../../planModel")>("../../planModel");
  return { ...actual, composeDayPlan: composeDayPlanMock };
});

import { nutritionAiPlanGenerateHandler } from "../nutritionAiPlanGenerateHandler";
import { coreErrorHandler } from "../../../../../../shared/errorHandler";
import Elysia from "elysia";

const TARGET = {
  userId: "test-user-id",
  dailyKcal: 2000,
  proteinG: 150,
  carbsG: 200,
  fatG: 60,
  waterCups: 8,
  preset: "maintain",
  setByUserId: null,
  setByName: null,
  updatedAt: null,
};

const PREFS = {
  userId: "test-user-id",
  dietaryPatterns: [] as string[],
  avoidAllergens: [] as string[],
  avoidFoods: [] as string[],
  likedFoods: [] as string[],
  mealsPerDay: 3,
  effortLevel: "balanced" as const,
  locale: "en-GB",
  updatedAt: null,
  isDefault: true,
};

function candidate(id: string, over: Record<string, unknown> = {}) {
  return {
    kind: "food" as const,
    id,
    name: `Food ${id}`,
    kcal: 600,
    proteinG: 45,
    carbsG: 60,
    fatG: 18,
    servingLabel: "1 serving",
    allergenTags: [] as string[] | null,
    categoryTags: null,
    isOwn: false,
    ...over,
  };
}

// Mounted behind coreErrorHandler so the EntitlementError → 402 mapping applies.
const app = new Elysia()
  .use(coreErrorHandler)
  .use(nutritionAiPlanGenerateHandler);

function post(body: unknown = {}, auth = true) {
  return new Request("http://localhost/nutrition/ai/plan-generate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

async function body(res: Response): Promise<any> {
  return res.json();
}

beforeEach(() => {
  vi.clearAllMocks();
  assertEntitlementMock.mockResolvedValue({ allowed: true });
  usageMocks.countForUserToday.mockResolvedValue(0);
  usageMocks.record.mockResolvedValue(undefined);
  targetMocks.get.mockResolvedValue(TARGET);
  prefMocks.get.mockResolvedValue(PREFS);
  candidateMocks.listCuratedCandidates.mockResolvedValue([
    candidate("c1"),
    candidate("c2"),
    candidate("c3"),
  ]);
  candidateMocks.listOwnFoodCandidates.mockResolvedValue([]);
  candidateMocks.listOwnRecipeCandidates.mockResolvedValue([]);
  candidateMocks.listOwnMealCandidates.mockResolvedValue([]);
  composeDayPlanMock.mockResolvedValue({
    meals: [
      {
        name: "Breakfast",
        reason: "protein",
        logSlot: "breakfast",
        items: [{ candidateId: "c1", servings: 1 }],
      },
      {
        name: "Lunch",
        reason: "carbs",
        logSlot: "lunch",
        items: [{ candidateId: "c2", servings: 1 }],
      },
      {
        name: "Dinner",
        reason: "fat",
        logSlot: "dinner",
        items: [{ candidateId: "c3", servings: 1 }],
      },
    ],
    usage: { modelId: "m", latencyMs: 10, inputTokens: 1, outputTokens: 1 },
  });
});

describe("POST /nutrition/ai/plan-generate", () => {
  it("401s without a token, before entitlement or reads", async () => {
    const res = await app.handle(post({}, false));
    expect(res.status).toBe(401);
    expect(assertEntitlementMock).not.toHaveBeenCalled();
  });

  it("402s an unentitled caller before any read or inference", async () => {
    assertEntitlementMock.mockResolvedValue({
      allowed: false,
      reason: "tier",
      currentTier: "premium",
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 29.99,
    });
    const res = await app.handle(post());
    expect(res.status).toBe(402);
    expect(composeDayPlanMock).not.toHaveBeenCalled();
    expect(usageMocks.record).not.toHaveBeenCalled();
  });

  it("429s at the daily ceiling, writing no usage row", async () => {
    usageMocks.countForUserToday.mockResolvedValue(5);
    const res = await app.handle(post());
    expect(res.status).toBe(429);
    expect((await body(res)).error).toBe("ai_daily_limit");
    expect(composeDayPlanMock).not.toHaveBeenCalled();
    expect(usageMocks.record).not.toHaveBeenCalled();
  });

  it("returns an empty draft (no_targets) when the user has no targets", async () => {
    targetMocks.get.mockResolvedValue(null);
    const res = await app.handle(post());
    expect(res.status).toBe(200);
    const parsed = await body(res);
    expect(parsed.data.emptyReason).toBe("no_targets");
    expect(composeDayPlanMock).not.toHaveBeenCalled();
  });

  it("returns an empty draft (no_candidates) rather than calling the model on an empty pool", async () => {
    candidateMocks.listCuratedCandidates.mockResolvedValue([]);
    const res = await app.handle(post());
    expect(res.status).toBe(200);
    expect((await body(res)).data.emptyReason).toBe("no_candidates");
    expect(composeDayPlanMock).not.toHaveBeenCalled();
    // No inference reached → no usage row.
    expect(usageMocks.record).not.toHaveBeenCalled();
  });

  it("recomputes macros from candidate rows, ignoring the model's numbers", async () => {
    const res = await app.handle(post());
    expect(res.status).toBe(200);
    const parsed = await body(res);
    // Each meal is one 600-kcal candidate → per-meal 600, totals 1800.
    expect(parsed.data.meals).toHaveLength(3);
    expect(parsed.data.meals[0].kcal).toBe(600);
    expect(parsed.data.totals.kcal).toBe(1800);
    expect(parsed.data.totals.proteinG).toBe(135);
  });

  it("flags withinTolerance false when the day total misses the target band", async () => {
    // 1800 kcal against a 2000 target is 10% under — outside the ±7% kcal band.
    const res = await app.handle(post());
    expect((await body(res)).data.withinTolerance).toBe(false);
  });

  it("flags withinTolerance true when totals land inside the band", async () => {
    targetMocks.get.mockResolvedValue({
      ...TARGET,
      dailyKcal: 1850,
      proteinG: 135,
      carbsG: 180,
      fatG: 54,
    });
    const res = await app.handle(post());
    expect((await body(res)).data.withinTolerance).toBe(true);
  });

  it("records a usage row once the model was reached", async () => {
    await app.handle(post());
    expect(usageMocks.record).toHaveBeenCalledTimes(1);
    expect(usageMocks.record.mock.calls[0]![0].endpoint).toBe(
      "/nutrition/ai/plan-generate",
    );
  });

  it("maps a truncated/garbled model response to 503 (unavailable) or 422 (unreadable)", async () => {
    const { AiUnreadableError } = await vi.importActual<
      typeof import("../../../../services/aiBedrockClient")
    >("../../../../services/aiBedrockClient");
    composeDayPlanMock.mockRejectedValue(
      new AiUnreadableError("ai_response_truncated"),
    );
    const res = await app.handle(post());
    expect(res.status).toBe(422);
    // The failed inference still consumed a real call → usage recorded.
    expect(usageMocks.record).toHaveBeenCalledTimes(1);
  });

  it("always sets labelCheckRequired true on a populated draft", async () => {
    const res = await app.handle(post());
    expect((await body(res)).data.labelCheckRequired).toBe(true);
  });

  it("marks a meal containsUnverified when a candidate's allergen tags are unknown", async () => {
    candidateMocks.listCuratedCandidates.mockResolvedValue([
      candidate("c1", { allergenTags: null }),
      candidate("c2"),
      candidate("c3"),
    ]);
    const res = await app.handle(post());
    const parsed = await body(res);
    const meal = parsed.data.meals.find((m: any) =>
      m.items.some((i: any) => i.candidateId === "c1"),
    );
    expect(meal.containsUnverified).toBe(true);
  });
});
