/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ⚠ `vi.hoisted` is required, not stylistic — see the sibling log-handler test
 * for why: the service files construct their repositories at MODULE LOAD, so
 * a plain `const` here would not exist yet when the mock factory runs.
 */
const { planMocks, candidateMocks, prefMocks, assertEntitlementMock } =
  vi.hoisted(() => ({
    planMocks: { replaceMeal: vi.fn(), get: vi.fn() },
    candidateMocks: { resolveByIds: vi.fn() },
    prefMocks: { get: vi.fn() },
    assertEntitlementMock: vi.fn(),
  }));

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

vi.mock("../../../../../repositories/mealPlanRepository", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../repositories/mealPlanRepository")
  >("../../../../../repositories/mealPlanRepository");
  return {
    ...actual,
    MealPlanRepository: vi.fn().mockImplementation(() => planMocks),
  };
});
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
vi.mock("../../../../../repositories/nutritionPreferenceRepository", () => ({
  NutritionPreferenceRepository: vi.fn().mockImplementation(() => prefMocks),
}));
vi.mock("../../../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../entitlement/assertEntitlement")
  >("../../../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: assertEntitlementMock };
});

import { nutritionPlanMealReplaceHandler } from "../nutritionPlanMealReplaceHandler";
import { coreErrorHandler } from "../../../../../../shared/errorHandler";
import Elysia from "elysia";

const app = new Elysia()
  .use(coreErrorHandler)
  .use(nutritionPlanMealReplaceHandler);

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const MEAL_ID = "22222222-2222-4222-8222-222222222222";
const FOOD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPE_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PREFS = {
  userId: "test-user-id",
  dietaryPatterns: [] as string[],
  avoidAllergens: [] as string[],
  avoidFoods: [] as string[],
  likedFoods: [] as string[],
  mealsPerDay: 4,
  effortLevel: "balanced" as const,
  locale: "en-GB",
  updatedAt: null,
  isDefault: true,
};

function food(id: string, over: Record<string, unknown> = {}) {
  return {
    kind: "food" as const,
    id,
    name: "Greek Yogurt",
    kcal: 170,
    proteinG: 17,
    carbsG: 7,
    fatG: 1,
    servingLabel: "170 g",
    servingBasis: "declared" as const,
    maxServings: 2,
    allergenTags: [] as string[] | null,
    categoryTags: [] as string[] | null,
    isOwn: false,
    ...over,
  };
}

function updatedPlan(over: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    userId: "test-user-id",
    status: "active",
    planDate: "2026-08-05",
    mealsPerDay: 4,
    targetKcal: 2400,
    meals: [],
    ...over,
  };
}

function replaceBody(over: Record<string, unknown> = {}) {
  return {
    label: "Meal 1 · Breakfast",
    logSlot: "breakfast",
    items: [{ foodId: FOOD_A, servings: 2 }],
    ...over,
  };
}

function post(body: unknown, auth = true) {
  return new Request(
    `http://localhost/nutrition/plans/${PLAN_ID}/meals/${MEAL_ID}/replace`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { authorization: "Bearer token" } : {}),
      },
    },
  );
}

async function body(res: Response): Promise<any> {
  return res.json();
}

beforeEach(() => {
  vi.clearAllMocks();
  assertEntitlementMock.mockResolvedValue({ allowed: true });
  prefMocks.get.mockResolvedValue(PREFS);
  candidateMocks.resolveByIds.mockResolvedValue([food(FOOD_A)]);
  planMocks.replaceMeal.mockResolvedValue(updatedPlan());
  // The already-logged guard's own read — defaults to a `planned` meal so
  // every pre-existing test in this file (none of which care about the
  // guard) falls straight through it.
  planMocks.get.mockResolvedValue(
    updatedPlan({ meals: [{ id: MEAL_ID, state: "planned" }] }),
  );
});

describe("POST /nutrition/plans/:id/meals/:mealId/replace", () => {
  it("402s before resolving or replacing a meal after entitlement loss", async () => {
    assertEntitlementMock.mockResolvedValue({
      allowed: false,
      reason: "cancelled",
      currentTier: "free",
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 1999,
    });

    const res = await app.handle(post(replaceBody()));

    expect(res.status).toBe(402);
    expect(candidateMocks.resolveByIds).not.toHaveBeenCalled();
    expect(planMocks.replaceMeal).not.toHaveBeenCalled();
  });
  it("401s without a bearer token", async () => {
    const res = await app.handle(post(replaceBody(), false));
    expect(res.status).toBe(401);
  });

  /**
   * ⚠ THE test for this handler — mirrors the accept handler's namesake. The
   * whole correctness model is that a persisted meal's macros come from the
   * DB, never the request. If this assertion ever needs to change, something
   * has gone wrong upstream.
   */
  it("recomputes macros from resolved rows and IGNORES any the client sent", async () => {
    const res = await app.handle(
      post(
        replaceBody({
          items: [{ foodId: FOOD_A, servings: 2 }],
          // A lie: the resolved food is 170 kcal/serving × 2 = 340.
          kcal: 10,
          proteinG: 0,
        }),
      ),
    );

    expect(res.status).toBe(200);
    const input = planMocks.replaceMeal.mock.calls[0]![3];
    expect(input.kcal).toBe(340);
    expect(input.proteinG).toBe(34);
    expect(input.carbsG).toBe(14);
    expect(input.fatG).toBe(2);
    expect(planMocks.replaceMeal).toHaveBeenCalledWith(
      "test-user-id",
      PLAN_ID,
      MEAL_ID,
      expect.any(Object),
    );
    expect((await body(res)).data).toEqual(updatedPlan());
  });

  it("multiplies a recipe-backed meal by its servings", async () => {
    candidateMocks.resolveByIds.mockResolvedValue([
      { ...food(RECIPE_A), kind: "recipe", kcal: 500, proteinG: 40 },
    ]);

    await app.handle(
      post(
        replaceBody({
          label: "Chilli",
          logSlot: "dinner",
          items: undefined,
          recipeId: RECIPE_A,
          servings: 1.5,
        }),
      ),
    );

    const input = planMocks.replaceMeal.mock.calls[0]![3];
    expect(input.kcal).toBe(750);
    expect(input.proteinG).toBe(60);
    expect(input.recipeId).toBe(RECIPE_A);
  });

  it("multiplies a saved-meal-backed replacement by its servings", async () => {
    const MEAL_ENTITY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    candidateMocks.resolveByIds.mockResolvedValue([
      { ...food(MEAL_ENTITY_ID), kind: "meal", kcal: 300, proteinG: 20 },
    ]);

    await app.handle(
      post(
        replaceBody({
          label: "Prepped bowl",
          logSlot: "lunch",
          items: undefined,
          mealId: MEAL_ENTITY_ID,
          servings: 2,
        }),
      ),
    );

    const input = planMocks.replaceMeal.mock.calls[0]![3];
    expect(input.kcal).toBe(600);
    expect(input.proteinG).toBe(40);
    expect(input.mealId).toBe(MEAL_ENTITY_ID);
  });

  it("defaults a recipe/meal-backed replacement to 1 serving when omitted", async () => {
    const MEAL_ENTITY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    candidateMocks.resolveByIds.mockResolvedValue([
      { ...food(RECIPE_A), kind: "recipe", kcal: 500, proteinG: 40 },
      { ...food(MEAL_ENTITY_ID), kind: "meal", kcal: 300, proteinG: 20 },
    ]);

    await app.handle(
      post(
        replaceBody({
          label: "Combo",
          logSlot: "dinner",
          items: undefined,
          recipeId: RECIPE_A,
          mealId: MEAL_ENTITY_ID,
          servings: undefined,
        }),
      ),
    );

    const input = planMocks.replaceMeal.mock.calls[0]![3];
    expect(input.kcal).toBe(800);
    expect(input.proteinG).toBe(60);
  });

  it("400s an unresolvable saved-meal reference", async () => {
    candidateMocks.resolveByIds.mockResolvedValue([]);
    const res = await app.handle(
      post(
        replaceBody({
          items: undefined,
          mealId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        }),
      ),
    );

    expect(res.status).toBe(400);
    const parsed = await body(res);
    expect(parsed.error).toBe("unresolvable_items");
    expect(parsed.items).toEqual(["meal:dddddddd-dddd-4ddd-8ddd-dddddddddddd"]);
    expect(planMocks.replaceMeal).not.toHaveBeenCalled();
  });

  it("400s listing EVERY unresolvable id, not just the first", async () => {
    candidateMocks.resolveByIds.mockResolvedValue([]);
    const res = await app.handle(
      post(
        replaceBody({
          items: [{ foodId: FOOD_A, servings: 1 }],
          recipeId: RECIPE_A,
        }),
      ),
    );

    expect(res.status).toBe(400);
    const parsed = await body(res);
    expect(parsed.error).toBe("unresolvable_items");
    expect(parsed.items).toEqual(
      expect.arrayContaining([`food:${FOOD_A}`, `recipe:${RECIPE_A}`]),
    );
    expect(planMocks.replaceMeal).not.toHaveBeenCalled();
  });

  it("422s rather than silently accepting a replacement that breaches an allergen", async () => {
    prefMocks.get.mockResolvedValue({ ...PREFS, avoidAllergens: ["milk"] });
    candidateMocks.resolveByIds.mockResolvedValue([
      food(FOOD_A, { allergenTags: ["en:milk"] }),
    ]);

    const res = await app.handle(post(replaceBody()));

    expect(res.status).toBe(422);
    expect((await body(res)).error).toBe("avoidance_violation");
    expect(planMocks.replaceMeal).not.toHaveBeenCalled();
  });

  it("422s a direct replacement above the allowed serving count", async () => {
    const res = await app.handle(
      post(replaceBody({ items: [{ foodId: FOOD_A, servings: 2.25 }] })),
    );

    expect(res.status).toBe(422);
    expect((await body(res)).error).toBe("portion_violation");
    expect(planMocks.replaceMeal).not.toHaveBeenCalled();
  });

  it("422s a reference-basis OFF row at the durable replace boundary", async () => {
    candidateMocks.resolveByIds.mockResolvedValue([
      food(FOOD_A, { servingBasis: "reference" }),
    ]);

    const res = await app.handle(post(replaceBody()));

    expect(res.status).toBe(422);
    expect((await body(res)).error).toBe("portion_violation");
    expect(planMocks.replaceMeal).not.toHaveBeenCalled();
  });

  /**
   * The orphan-nutrition-entry bug: `replaceMeal` unconditionally resets
   * `state` to `"planned"` and clears `loggedEntryId`, so replacing an
   * already-logged meal would double-count (the old `nutrition_entries` row
   * keeps counting toward consumed AND the meal re-surfaces as loggable).
   * This guard reads the plan BEFORE any resolve/write work and bails with
   * no write — assert on `replaceMeal` never being called, not just the
   * status, since a 409 that still wrote would reintroduce the bug.
   */
  it("409s and writes nothing when the target meal is already logged", async () => {
    planMocks.get.mockResolvedValue(
      updatedPlan({
        meals: [{ id: MEAL_ID, state: "logged", loggedEntryId: "entry-1" }],
      }),
    );

    const res = await app.handle(post(replaceBody()));

    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe("meal_already_logged");
    expect(planMocks.replaceMeal).not.toHaveBeenCalled();
    expect(candidateMocks.resolveByIds).not.toHaveBeenCalled();
  });

  it("404s an unknown plan/meal", async () => {
    planMocks.replaceMeal.mockResolvedValue(null);
    const res = await app.handle(post(replaceBody()));

    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("meal_not_found");
  });

  /**
   * Two-user isolation: user B must never be able to replace a meal in user
   * A's plan. `resolveByIds` is user-scoped, so a food belonging to A simply
   * never resolves for B — that alone already 400s. But the boundary also
   * has to hold in the (rarer) case every referenced id happens to be public:
   * `replaceMeal` re-scopes by userId at the write and returns null, which
   * this handler turns into 404 rather than leaking whether the plan exists.
   */
  it("blocks a cross-user replace: A's private food is unresolvable for B", async () => {
    candidateMocks.resolveByIds.mockResolvedValue([]); // B never resolves A's private food
    const res = await app.handle(post(replaceBody()));

    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("unresolvable_items");
    expect(planMocks.replaceMeal).not.toHaveBeenCalled();
  });

  it("blocks a cross-user replace even when every id resolves (public foods): ownership 404s", async () => {
    // All items are public, so resolveByIds succeeds — but the plan/meal
    // belongs to a different user, so the repository's own scope rejects it.
    planMocks.replaceMeal.mockResolvedValue(null);
    const res = await app.handle(post(replaceBody()));

    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("meal_not_found");
  });
});
