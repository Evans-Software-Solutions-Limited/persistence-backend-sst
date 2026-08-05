/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const usageMocks = vi.hoisted(() => ({
  countForUserToday: vi.fn(),
  record: vi.fn(),
}));
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
  NutritionTargetRepository: vi
    .fn()
    .mockImplementation(() => ({ get: vi.fn() })),
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

import { nutritionAiPlanMealSwapHandler } from "../nutritionAiPlanMealSwapHandler";
import { coreErrorHandler } from "../../../../../../shared/errorHandler";
import Elysia from "elysia";

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
    kcal: 400,
    proteinG: 30,
    carbsG: 40,
    fatG: 12,
    servingLabel: "1 serving",
    allergenTags: [] as string[] | null,
    categoryTags: null,
    isOwn: false,
    ...over,
  };
}

const app = new Elysia()
  .use(coreErrorHandler)
  .use(nutritionAiPlanMealSwapHandler);

function post(over: Record<string, unknown> = {}, auth = true) {
  const defaultBody = {
    dayTarget: { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
    heldTotals: { kcal: 1400, proteinG: 110, carbsG: 150, fatG: 44 },
    logSlot: "dinner",
  };
  return new Request("http://localhost/nutrition/ai/plan-meal-swap", {
    method: "POST",
    body: JSON.stringify({ ...defaultBody, ...over }),
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
  prefMocks.get.mockResolvedValue(PREFS);
  candidateMocks.listCuratedCandidates.mockResolvedValue([candidate("c1")]);
  candidateMocks.listOwnFoodCandidates.mockResolvedValue([]);
  candidateMocks.listOwnRecipeCandidates.mockResolvedValue([]);
  candidateMocks.listOwnMealCandidates.mockResolvedValue([]);
  composeDayPlanMock.mockResolvedValue({
    meals: [
      {
        name: "Salmon & rice",
        reason: "fills the gap",
        logSlot: "breakfast", // deliberately wrong — the handler must override
        items: [{ candidateId: "c1", servings: 1 }],
      },
    ],
    usage: { modelId: "m", latencyMs: 5, inputTokens: 1, outputTokens: 1 },
  });
});

describe("POST /nutrition/ai/plan-meal-swap", () => {
  it("402s an unentitled caller", async () => {
    assertEntitlementMock.mockResolvedValue({
      allowed: false,
      reason: "tier",
      currentTier: "premium",
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 29.99,
    });
    expect((await app.handle(post())).status).toBe(402);
  });

  it("429s at the swap ceiling", async () => {
    usageMocks.countForUserToday.mockResolvedValue(10);
    expect((await app.handle(post())).status).toBe(429);
    expect(composeDayPlanMock).not.toHaveBeenCalled();
  });

  it("composes ONE meal against the REMAINING budget (day target minus held)", async () => {
    await app.handle(post());
    const arg = composeDayPlanMock.mock.calls[0]![0];
    // 2000-1400 = 600 kcal remaining; 150-110 = 40 protein.
    expect(arg.target.kcal).toBe(600);
    expect(arg.target.proteinG).toBe(40);
    expect(arg.mealsPerDay).toBe(1);
  });

  it("keeps the slot the client asked to fill, not the model's choice", async () => {
    const res = await app.handle(post({ logSlot: "dinner" }));
    const parsed = await body(res);
    // The model returned logSlot 'breakfast'; the handler must force 'dinner'.
    expect(parsed.data.meal.logSlot).toBe("dinner");
  });

  it("recomputes the meal's macros from the candidate row", async () => {
    const res = await app.handle(post());
    const parsed = await body(res);
    expect(parsed.data.meal.kcal).toBe(400);
    expect(parsed.data.meal.proteinG).toBe(30);
  });

  // Mealprint gaps 1+2: a swap-in item needs the same kind + per-serving
  // macros as generate, so a recipe/meal-kind replacement routes correctly
  // on accept and the draft can recompute servings edits client-side.
  it("carries the swapped item's candidate kind and per-serving macros", async () => {
    candidateMocks.listOwnRecipeCandidates.mockResolvedValue([
      candidate("r1", { kind: "recipe", kcal: 500, proteinG: 40 }),
    ]);
    composeDayPlanMock.mockResolvedValue({
      meals: [
        {
          name: "Chilli",
          reason: "fills the gap",
          logSlot: "breakfast",
          items: [{ candidateId: "r1", servings: 1 }],
        },
      ],
      usage: { modelId: "m", latencyMs: 5, inputTokens: 1, outputTokens: 1 },
    });

    const res = await app.handle(post());
    const parsed = await body(res);
    const [item] = parsed.data.meal.items;
    expect(item.kind).toBe("recipe");
    expect(item.kcal).toBe(500);
    expect(item.proteinG).toBe(40);
  });

  it("returns budget_exhausted (no model call) when held meals already meet the day", async () => {
    const res = await app.handle(
      post({
        heldTotals: { kcal: 1990, proteinG: 149, carbsG: 199, fatG: 59 },
      }),
    );
    expect(res.status).toBe(200);
    expect((await body(res)).data.emptyReason).toBe("budget_exhausted");
    expect(composeDayPlanMock).not.toHaveBeenCalled();
    expect(usageMocks.record).not.toHaveBeenCalled();
  });

  it("returns no_candidates when the pool is empty after filtering", async () => {
    candidateMocks.listCuratedCandidates.mockResolvedValue([]);
    const res = await app.handle(post());
    expect((await body(res)).data.emptyReason).toBe("no_candidates");
    expect(composeDayPlanMock).not.toHaveBeenCalled();
  });

  it("records a usage row once the model was reached", async () => {
    await app.handle(post());
    expect(usageMocks.record).toHaveBeenCalledTimes(1);
    expect(usageMocks.record.mock.calls[0]![0].endpoint).toBe(
      "/nutrition/ai/plan-meal-swap",
    );
  });

  it("rejects a body missing dayTarget", async () => {
    const res = await app.handle(
      new Request("http://localhost/nutrition/ai/plan-meal-swap", {
        method: "POST",
        body: JSON.stringify({ heldTotals: {}, logSlot: "dinner" }),
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer token",
        },
      }),
    );
    expect(res.status).toBe(422);
  });
});
