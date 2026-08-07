/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Same hoisting requirement as `nutritionPlansHandlers.test.ts` — importing
// the handler constructs `MealPlanService`'s `new MealPlanRepository()` at
// module load, so the mock factory must exist before that import runs.
const { planMocks, assertEntitlementMock } = vi.hoisted(() => ({
  planMocks: { getShoppingSource: vi.fn() },
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
vi.mock("../../../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../entitlement/assertEntitlement")
  >("../../../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: assertEntitlementMock };
});

import { nutritionPlanShoppingHandlers } from "../nutritionPlanShoppingHandler";

const PLAN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function get(path: string, auth = true) {
  return new Request(`http://localhost${path}`, {
    headers: auth ? { authorization: "Bearer token" } : {},
  });
}

async function body(res: Response): Promise<any> {
  return res.json();
}

beforeEach(() => {
  vi.clearAllMocks();
  assertEntitlementMock.mockResolvedValue({ allowed: true });
});

describe("GET /nutrition/plans/:id/shopping", () => {
  it("401s an unauthenticated read", async () => {
    const res = await nutritionPlanShoppingHandlers.handle(
      get(`/nutrition/plans/${PLAN_ID}/shopping`, false),
    );
    expect(res.status).toBe(401);
    expect(planMocks.getShoppingSource).not.toHaveBeenCalled();
  });

  it("404s a plan id that is not the caller's, same posture as the other plan reads", async () => {
    planMocks.getShoppingSource.mockResolvedValue(null);
    const res = await nutritionPlanShoppingHandlers.handle(
      get(`/nutrition/plans/${PLAN_ID}/shopping`),
    );

    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("not_found");
  });

  it("passes the caller's id and the plan id to the repository", async () => {
    planMocks.getShoppingSource.mockResolvedValue({
      planId: PLAN_ID,
      meals: [],
      recipeIngredients: [],
      mealItems: [],
      foods: [],
      recipeTotals: [],
      mealTotals: [],
    });

    await nutritionPlanShoppingHandlers.handle(
      get(`/nutrition/plans/${PLAN_ID}/shopping`),
    );

    expect(planMocks.getShoppingSource).toHaveBeenCalledWith(
      "test-user-id",
      PLAN_ID,
    );
  });

  it("returns the derived, aisle-grouped shopping list", async () => {
    planMocks.getShoppingSource.mockResolvedValue({
      planId: PLAN_ID,
      meals: [
        {
          kcal: 100,
          recipeId: null,
          mealId: null,
          items: [{ foodId: "food-1", servings: 2 }],
        },
      ],
      recipeIngredients: [],
      mealItems: [],
      foods: [
        {
          id: "food-1",
          name: "Chicken breast",
          servingSize: 100,
          servingUnit: "g",
          servingQuantity: null,
          categoryTags: ["en:meats"],
        },
      ],
      recipeTotals: [],
      mealTotals: [],
    });

    const res = await nutritionPlanShoppingHandlers.handle(
      get(`/nutrition/plans/${PLAN_ID}/shopping`),
    );

    expect(res.status).toBe(200);
    const parsed = await body(res);
    expect(parsed.data).toEqual({
      planId: PLAN_ID,
      aisles: [
        {
          aisle: "Meat & fish",
          items: [{ id: "food-1", name: "Chicken breast", quantity: "200g" }],
        },
      ],
      totalItems: 1,
    });
  });

  it("rejects a non-uuid plan id", async () => {
    const res = await nutritionPlanShoppingHandlers.handle(
      get("/nutrition/plans/not-a-uuid/shopping"),
    );
    expect(res.status).toBe(422);
  });
});
