/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PER-119 (Design D test 5) — `plan-meal-swap` `count: 1 | 3`, through the
 * REAL composer (`composeDayPlan`), candidate assembly and avoidance filter.
 * Only the edges are faked: auth, the repositories, the AI budget and the
 * Bedrock client (no provider call is ever made).
 */

const model = vi.hoisted(() => ({
  toolInput: null as unknown,
  prompts: [] as string[],
}));
vi.mock("../../../../services/aiBedrockClient", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../services/aiBedrockClient")
  >("../../../../services/aiBedrockClient");
  return {
    ...actual,
    getDefaultClient: () => ({
      messages: {
        create: async (params: any) => {
          model.prompts.push(params.messages[0].content[0].text);
          return {
            content: [
              {
                type: "tool_use",
                name: "compose_day_plan",
                input: model.toolInput,
              },
            ],
            stop_reason: "tool_use",
            usage: { input_tokens: 10, output_tokens: 10 },
          };
        },
      },
    }),
  };
});
vi.mock("../../../../../ai/aiBudget", () => ({
  AI_BUDGET_EXHAUSTED_BODY: { error: "ai_budget_exhausted" },
  hasAiBudget: async () => true,
}));

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

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    h?.startsWith("Bearer ") ? { sub: "test-user-id" } : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user),
}));
vi.mock("../../../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../entitlement/assertEntitlement")
  >("../../../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: async () => ({ allowed: true }) };
});
vi.mock("../../../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn().mockImplementation(function () {
    return usageMocks;
  }),
}));
vi.mock("../../../../../repositories/nutritionTargetRepository", () => ({
  NutritionTargetRepository: vi.fn().mockImplementation(function () {
    return { get: vi.fn() };
  }),
}));
vi.mock("../../../../../repositories/nutritionPreferenceRepository", () => ({
  NutritionPreferenceRepository: vi.fn().mockImplementation(function () {
    return prefMocks;
  }),
}));
vi.mock(
  "../../../../../repositories/mealprintCandidateRepository",
  async () => {
    const actual = await vi.importActual<
      typeof import("../../../../../repositories/mealprintCandidateRepository")
    >("../../../../../repositories/mealprintCandidateRepository");
    return {
      ...actual,
      MealprintCandidateRepository: vi.fn().mockImplementation(function () {
        return candidateMocks;
      }),
    };
  },
);

import Elysia from "elysia";
import { nutritionAiPlanMealSwapHandler } from "../nutritionAiPlanMealSwapHandler";
import { coreErrorHandler } from "../../../../../../shared/errorHandler";

const PREFS = {
  userId: "test-user-id",
  dietaryPatterns: [] as string[],
  avoidAllergens: ["fish"],
  avoidFoods: [] as string[],
  likedFoods: [] as string[],
  mealsPerDay: 3,
  effortLevel: "balanced" as const,
  locale: "en-GB",
  updatedAt: null,
  isDefault: false,
};

function candidate(
  id: string,
  name: string,
  over: Record<string, unknown> = {},
) {
  return {
    kind: "food" as const,
    id,
    name,
    kcal: 250,
    proteinG: 20,
    carbsG: 25,
    fatG: 8,
    servingLabel: "1 serving",
    servingBasis: "declared" as const,
    maxServings: 2,
    allergenTags: [] as string[] | null,
    categoryTags: null,
    isOwn: false,
    ...over,
  };
}

const CHICKEN = candidate("chicken", "Chicken breast");
const RICE = candidate("rice", "Basmati rice");
const EGGS = candidate("eggs", "Eggs", { allergenTags: ["en:eggs"] });
const BEANS = candidate("beans", "Black beans");
const TOFU = candidate("tofu", "Tofu", { allergenTags: ["en:soybeans"] });
const SALMON = candidate("salmon", "Salmon fillet", {
  allergenTags: ["en:fish"],
});
const MUSHROOMS = candidate("mush", "Mushrooms");

const app = new Elysia()
  .use(coreErrorHandler)
  .use(nutritionAiPlanMealSwapHandler);

function post(over: Record<string, unknown> = {}) {
  return app.handle(
    new Request("http://localhost/nutrition/ai/plan-meal-swap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({
        dayTarget: { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
        heldTotals: { kcal: 1400, proteinG: 110, carbsG: 150, fatG: 44 },
        logSlot: "dinner",
        mealsPerDay: 3,
        ...over,
      }),
    }),
  );
}

const meal = (name: string, ids: string[]) => ({
  name,
  reason: `${name} fits`,
  logSlot: "lunch",
  items: ids.map((candidateId) => ({ candidateId, servings: 1 })),
});

beforeEach(() => {
  vi.clearAllMocks();
  model.prompts = [];
  usageMocks.countForUserToday.mockResolvedValue(0);
  usageMocks.record.mockResolvedValue(undefined);
  prefMocks.get.mockResolvedValue(PREFS);
  candidateMocks.listCuratedCandidates.mockResolvedValue([
    CHICKEN,
    RICE,
    EGGS,
    BEANS,
    TOFU,
    SALMON,
    MUSHROOMS,
  ]);
  candidateMocks.listOwnFoodCandidates.mockResolvedValue([]);
  candidateMocks.listOwnRecipeCandidates.mockResolvedValue([]);
  candidateMocks.listOwnMealCandidates.mockResolvedValue([]);
});

describe("count absent — the 1.2.0 contract", () => {
  it("matches the recorded 1.2.0 response exactly (no options[])", async () => {
    model.toolInput = { meals: [meal("Chicken & rice", ["chicken", "rice"])] };
    const res = await post();
    expect(res.status).toBe(200);
    // Recorded 1.2.0 shape: data.{meal, emptyReason, labelCheckRequired}.
    expect(await res.json()).toEqual({
      data: {
        meal: {
          name: "Chicken & rice",
          reason: "Chicken & rice fits",
          logSlot: "dinner",
          items: [
            {
              candidateId: "chicken",
              kind: "food",
              servings: 1,
              name: "Chicken breast",
              kcal: 250,
              proteinG: 20,
              carbsG: 25,
              fatG: 8,
            },
            {
              candidateId: "rice",
              kind: "food",
              servings: 1,
              name: "Basmati rice",
              kcal: 250,
              proteinG: 20,
              carbsG: 25,
              fatG: 8,
            },
          ],
          kcal: 500,
          proteinG: 40,
          carbsG: 50,
          fatG: 16,
          containsUnverified: false,
        },
        emptyReason: null,
        labelCheckRequired: true,
      },
    });
    // The 1.2.0 prompt: one meal, never the alternatives task.
    expect(model.prompts[0]).toContain("Compose exactly 1 meals for the day.");
    expect(model.prompts[0]).not.toContain("alternative options");
  });

  it("keeps the 1.2.0 empty shape (no options key)", async () => {
    const res = await post({
      heldTotals: { kcal: 1990, proteinG: 150, carbsG: 200, fatG: 60 },
    });
    expect(await res.json()).toEqual({
      data: {
        meal: null,
        emptyReason: "budget_exhausted",
        labelCheckRequired: true,
      },
    });
  });
});

describe("count: 3", () => {
  it("returns 3 distinct options that respect allergens and the exclude list", async () => {
    model.toolInput = {
      meals: [
        meal("Chicken & rice", ["chicken", "rice"]),
        // Allergen (fish): never pooled, so the composer drops it as a
        // non-member id.
        meal("Salmon bowl", ["salmon", "rice"]),
        // The exclude list ("Show 3 others" sends the shown options in
        // notWantedMeals): same foods as a turned-down meal → dropped.
        meal("Creamy mushroom rice", ["mush", "rice"]),
        meal("Egg fried rice", ["eggs", "rice"]),
        meal("Bean chilli", ["beans", "rice"]),
        meal("Tofu stir fry", ["tofu"]),
      ],
    };
    const notWantedMeals = [
      { name: "Mushroom risotto", ingredients: ["Basmati rice", "Mushrooms"] },
    ];
    const res = await post({ count: 3, notWantedMeals });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.options.map((o: any) => o.name)).toEqual([
      "Chicken & rice",
      "Egg fried rice",
      "Bean chilli",
    ]);
    expect(new Set(data.options.map((o: any) => o.name)).size).toBe(3);
    expect(data.meal).toEqual(data.options[0]);
    const ids = data.options.flatMap((o: any) =>
      o.items.map((i: any) => i.candidateId),
    );
    expect(ids).not.toContain("salmon");
    expect(ids).not.toContain("mush");
    for (const option of data.options) expect(option.logSlot).toBe("dinner");
    expect(data.emptyReason).toBeNull();
    expect(data.labelCheckRequired).toBe(true);
    // The pool sent to the model never carried the allergen row, and the
    // exclude list reached the model.
    expect(model.prompts[0]).not.toContain("salmon |");
    expect(model.prompts[0]).toContain("Mushroom risotto");
    expect(model.prompts[0]).toContain(
      "Compose exactly 3 alternative options for this one meal.",
    );
  });

  it("drops a repeated option and one the person already turned down", async () => {
    model.toolInput = {
      meals: [
        meal("Chicken & rice", ["chicken", "rice"]),
        meal("Chicken and rice!", ["beans"]), // same name, normalised
        meal("Rice with chicken", ["rice", "chicken"]), // same foods
        meal("Bean chilli", ["beans", "rice"]), // turned down
        meal("Egg fried rice", ["eggs", "rice"]),
      ],
    };
    const notWantedMeals = [
      { name: "Bean Chilli", ingredients: ["Black beans", "Basmati rice"] },
    ];
    const res = await post({ count: 3, notWantedMeals, steer: "no beans" });
    const { data } = (await res.json()) as any;
    expect(data.options.map((o: any) => o.name)).toEqual([
      "Chicken & rice",
      "Egg fried rice",
    ]);
    expect(model.prompts[0]).toContain("Bean Chilli");
    expect(model.prompts[0]).toContain("no beans");
  });

  it("drops an option over the portion ceiling and keeps the rest", async () => {
    model.toolInput = {
      meals: [
        {
          ...meal("Huge chicken", []),
          items: [
            { candidateId: "chicken", servings: 2 },
            { candidateId: "rice", servings: 2 },
          ],
        },
        meal("Bean chilli", ["beans", "rice"]),
      ],
    };
    const { data } = (await (await post({ count: 3 })).json()) as any;
    expect(data.options.map((o: any) => o.name)).toEqual(["Bean chilli"]);
  });

  it("422s when no option survives verification", async () => {
    model.toolInput = {
      meals: [
        {
          ...meal("Huge chicken", []),
          items: [
            { candidateId: "chicken", servings: 2 },
            { candidateId: "rice", servings: 2 },
          ],
        },
      ],
    };
    const res = await post({ count: 3 });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "ai_unreadable" });
  });

  it("adds an empty options[] to the empty responses", async () => {
    candidateMocks.listCuratedCandidates.mockResolvedValue([SALMON]);
    const res = await post({ count: 3 });
    expect(await res.json()).toEqual({
      data: {
        meal: null,
        options: [],
        emptyReason: "no_candidates",
        labelCheckRequired: true,
      },
    });
  });

  it("rejects a count other than 1 or 3", async () => {
    expect((await post({ count: 2 })).status).toBe(422);
  });
});

describe("count: 1", () => {
  it("returns the single meal as options[0] with the 1.2.0 prompt", async () => {
    model.toolInput = { meals: [meal("Chicken & rice", ["chicken", "rice"])] };
    const { data } = (await (await post({ count: 1 })).json()) as any;
    expect(data.options).toHaveLength(1);
    expect(data.options[0]).toEqual(data.meal);
    expect(model.prompts[0]).toContain("Compose exactly 1 meals for the day.");
  });

  it("still 422s on a failing meal, as without count", async () => {
    model.toolInput = {
      meals: [
        {
          ...meal("Huge", []),
          items: [
            { candidateId: "chicken", servings: 2 },
            { candidateId: "rice", servings: 2 },
          ],
        },
      ],
    };
    expect((await post({ count: 1 })).status).toBe(422);
  });
});
