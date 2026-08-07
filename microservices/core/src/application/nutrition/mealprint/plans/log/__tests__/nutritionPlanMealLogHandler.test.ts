/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const planMocks = vi.hoisted(() => ({
  get: vi.fn(),
  markMealLogged: vi.fn(),
}));
const entryMocks = vi.hoisted(() => ({ create: vi.fn(), delete: vi.fn() }));
const candidateMocks = vi.hoisted(() => ({ resolveByIds: vi.fn() }));
const assertEntitlementMock = vi.hoisted(() => vi.fn());

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
vi.mock("../../../../../repositories/nutritionEntryRepository", () => ({
  NutritionEntryRepository: vi.fn().mockImplementation(() => entryMocks),
}));
vi.mock("../../../../../repositories/mealprintCandidateRepository", () => ({
  MealprintCandidateRepository: vi
    .fn()
    .mockImplementation(() => candidateMocks),
}));
vi.mock("../../../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../entitlement/assertEntitlement")
  >("../../../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: assertEntitlementMock };
});

import { nutritionPlanMealLogHandler } from "../nutritionPlanMealLogHandler";
import { coreErrorHandler } from "../../../../../../shared/errorHandler";
import Elysia from "elysia";

const app = new Elysia().use(coreErrorHandler).use(nutritionPlanMealLogHandler);

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const MEAL_ID = "22222222-2222-4222-8222-222222222222";
const ENTRY_ID = "33333333-3333-4333-8333-333333333333";

function meal(over: Record<string, unknown> = {}) {
  return {
    id: MEAL_ID,
    sortOrder: 0,
    label: "Meal 1 · Breakfast",
    logSlot: "breakfast",
    recipeId: null,
    mealId: null,
    items: [{ foodId: "f1", servings: 2 }],
    kcal: 520,
    proteinG: 42,
    carbsG: 50,
    fatG: 14,
    aiReason: null,
    state: "planned",
    loggedEntryId: null,
    ...over,
  };
}

function plan(over: Record<string, unknown> = {}, meals = [meal()]) {
  return {
    id: PLAN_ID,
    userId: "test-user-id",
    status: "active",
    planDate: "2026-08-05",
    meals,
    ...over,
  };
}

function req() {
  return new Request(
    `http://localhost/nutrition/plans/${PLAN_ID}/meals/${MEAL_ID}/log`,
    { method: "POST", headers: { authorization: "Bearer token" } },
  );
}

async function body(res: Response): Promise<any> {
  return res.json();
}

beforeEach(() => {
  vi.clearAllMocks();
  assertEntitlementMock.mockResolvedValue({ allowed: true });
  planMocks.get.mockResolvedValue(plan());
  planMocks.markMealLogged.mockResolvedValue(true);
  entryMocks.create.mockResolvedValue({ id: ENTRY_ID });
  entryMocks.delete.mockResolvedValue(true);
  candidateMocks.resolveByIds.mockResolvedValue([{ kind: "food", id: "f1" }]);
});

describe("POST /nutrition/plans/:id/meals/:mealId/log", () => {
  it("402s before creating a Fuel entry after entitlement loss", async () => {
    assertEntitlementMock.mockResolvedValue({
      allowed: false,
      reason: "expired",
      currentTier: "free",
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 1999,
    });
    const res = await app.handle(req());

    expect(res.status).toBe(402);
    expect(entryMocks.create).not.toHaveBeenCalled();
  });
  it("404s a plan that is not the caller's", async () => {
    planMocks.get.mockResolvedValue(null);
    const res = await app.handle(req());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("plan_not_found");
  });

  it("404s when the meal id is not in the plan", async () => {
    planMocks.get.mockResolvedValue(plan({}, [meal({ id: "other" })]));
    const res = await app.handle(req());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("meal_not_found");
  });

  it("creates an entry from the meal's DENORMALISED macros on the plan's date", async () => {
    await app.handle(req());
    const input = entryMocks.create.mock.calls[0]![1];
    expect(input.kcal).toBe(520);
    expect(input.proteinG).toBe(42);
    expect(input.mealSlot).toBe("breakfast");
    expect(input.servings).toBe(1);
    // Noon UTC on the plan date — buckets correctly for every timezone.
    expect(input.loggedAt).toBe("2026-08-05T12:00:00.000Z");
    // An item-list meal carries its label as the diary custom name.
    expect(input.customName).toBe("Meal 1 · Breakfast");
    expect(input.foodId).toBeNull();
  });

  it("409s when a plan source has since been quarantined", async () => {
    candidateMocks.resolveByIds.mockResolvedValue([]);
    const res = await app.handle(req());
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe("plan_meal_nutrition_unavailable");
    expect(candidateMocks.resolveByIds).toHaveBeenCalledWith("test-user-id", {
      foodIds: ["f1"],
      recipeIds: [],
      mealIds: [],
    });
    expect(entryMocks.create).not.toHaveBeenCalled();
  });

  it("carries the recipe id when the meal is recipe-backed, with no custom name", async () => {
    candidateMocks.resolveByIds.mockResolvedValue([
      { kind: "recipe", id: "rec-1" },
    ]);
    planMocks.get.mockResolvedValue(
      plan({}, [meal({ recipeId: "rec-1", items: null })]),
    );
    await app.handle(req());
    const input = entryMocks.create.mock.calls[0]![1];
    expect(input.recipeId).toBe("rec-1");
    expect(input.customName).toBeNull();
  });

  it("links the entry and reports success", async () => {
    const res = await app.handle(req());
    expect(res.status).toBe(200);
    const parsed = await body(res);
    expect(parsed.data.loggedEntryId).toBe(ENTRY_ID);
    expect(parsed.data.alreadyLogged).toBe(false);
    expect(planMocks.markMealLogged).toHaveBeenCalledWith(
      "test-user-id",
      PLAN_ID,
      MEAL_ID,
      ENTRY_ID,
    );
  });

  it("is idempotent: an already-logged meal returns its existing link and creates NO entry", async () => {
    planMocks.get.mockResolvedValue(
      plan({}, [meal({ state: "logged", loggedEntryId: "existing" })]),
    );
    const res = await app.handle(req());
    expect(res.status).toBe(200);
    const parsed = await body(res);
    expect(parsed.data.loggedEntryId).toBe("existing");
    expect(parsed.data.alreadyLogged).toBe(true);
    expect(entryMocks.create).not.toHaveBeenCalled();
  });

  it("rolls back the entry it created if it loses the log race", async () => {
    // markMealLogged returns false → a concurrent request logged this meal
    // between our read and our write. The entry we created must be deleted, or
    // the meal ends up with two diary rows.
    planMocks.markMealLogged.mockResolvedValue(false);
    planMocks.get
      .mockResolvedValueOnce(plan())
      .mockResolvedValueOnce(
        plan({}, [meal({ state: "logged", loggedEntryId: "winner" })]),
      );

    const res = await app.handle(req());
    expect(res.status).toBe(200);
    expect(entryMocks.delete).toHaveBeenCalledWith(ENTRY_ID, "test-user-id");
    const parsed = await body(res);
    expect(parsed.data.loggedEntryId).toBe("winner");
    expect(parsed.data.alreadyLogged).toBe(true);
  });

  it("401s without a token", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/nutrition/plans/${PLAN_ID}/meals/${MEAL_ID}/log`,
        { method: "POST" },
      ),
    );
    expect(res.status).toBe(401);
  });
});
