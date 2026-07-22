/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const entryMocks = { create: vi.fn() };
const foodMocks = { getById: vi.fn() };
const recipeMocks = { getById: vi.fn() };
const mealMocks = { getById: vi.fn() };

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

vi.mock("../../../../repositories/nutritionEntryRepository", () => ({
  NutritionEntryRepository: vi.fn().mockImplementation(() => entryMocks),
}));
vi.mock("../../../../repositories/foodRepository", () => ({
  FoodRepository: vi.fn().mockImplementation(() => foodMocks),
}));
vi.mock("../../../../repositories/recipeRepository", () => ({
  RecipeRepository: vi.fn().mockImplementation(() => recipeMocks),
}));
vi.mock("../../../../repositories/mealRepository", () => ({
  MealRepository: vi.fn().mockImplementation(() => mealMocks),
}));

function post(body: unknown, auth = true) {
  return new Request("http://localhost/nutrition/entries", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

const created = {
  id: "e1",
  userId: "test-user-id",
  foodId: "f1",
  recipeId: null,
  mealId: null,
  mealSlot: "breakfast",
  servings: 2,
  kcal: 300,
  proteinG: 20,
  carbsG: 40,
  fatG: 10,
  loggedAt: "2026-06-21T08:00:00.000Z",
  loggedByUserId: null,
  aiEstimated: false,
  aiConfidence: null,
  customName: null,
};

describe("nutritionEntriesCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entryMocks.create.mockResolvedValue(created);
  });

  it("requires auth", async () => {
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post(
        {
          mealSlot: "breakfast",
          servings: 1,
          kcal: 1,
          proteinG: 1,
          carbsG: 1,
          fatG: 1,
          loggedAt: "2026-06-21T08:00:00.000Z",
        },
        false,
      ),
    );
    expect(res.status).toBe(401);
  });

  it("re-derives macros server-side from the referenced food × servings", async () => {
    foodMocks.getById.mockResolvedValue({
      id: "f1",
      kcal: 150,
      proteinG: 10,
      carbsG: 20,
      fatG: 5,
      servingSize: 40,
      servingUnit: "g",
    });
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post({
        foodId: "f1",
        mealSlot: "breakfast",
        servings: 2,
        // client sends bogus macros — server must ignore them for a foodId entry
        kcal: 99999,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        loggedAt: "2026-06-21T08:00:00.000Z",
      }),
    );
    expect(res.status).toBe(201);
    // Scoped lookup — getById must receive the caller's userId so a foreign
    // private food can't be referenced (PR #124 review).
    expect(foodMocks.getById).toHaveBeenCalledWith("f1", "test-user-id");
    expect(entryMocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({
        kcal: 300,
        proteinG: 20,
        carbsG: 40,
        fatG: 10,
      }),
    );
  });

  it("re-derives recipe macros PER SERVING (total / recipe.servings × servings)", async () => {
    // Recipe makes 4 servings totalling 800 kcal → 200 kcal/serving.
    recipeMocks.getById.mockResolvedValue({
      id: "r1",
      servings: 4,
      totalKcal: 800,
      totalProteinG: 40,
      totalCarbsG: 100,
      totalFatG: 20,
    });
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post({
        recipeId: "r1",
        mealSlot: "dinner",
        servings: 1, // one portion
        loggedAt: "2026-06-21T19:00:00.000Z",
      }),
    );
    expect(res.status).toBe(201);
    expect(recipeMocks.getById).toHaveBeenCalledWith("r1", "test-user-id");
    expect(entryMocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({
        kcal: 200,
        proteinG: 10,
        carbsG: 25,
        fatG: 5,
      }),
    );
  });

  it("treats a recipe with 0/invalid servings as 1 (no divide-by-zero)", async () => {
    recipeMocks.getById.mockResolvedValue({
      id: "r1",
      servings: 0,
      totalKcal: 500,
      totalProteinG: null,
      totalCarbsG: null,
      totalFatG: null,
    });
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post({
        recipeId: "r1",
        mealSlot: "lunch",
        servings: 1,
        loggedAt: "2026-06-21T12:00:00.000Z",
      }),
    );
    expect(res.status).toBe(201);
    expect(entryMocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ kcal: 500, proteinG: 0, carbsG: 0, fatG: 0 }),
    );
  });

  it("400s when the referenced recipe is missing", async () => {
    recipeMocks.getById.mockResolvedValue(null);
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post({
        recipeId: "missing",
        mealSlot: "lunch",
        servings: 1,
        loggedAt: "2026-06-21T12:00:00.000Z",
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("recipe_not_found");
  });

  it("re-derives meal macros as the meal total × servings", async () => {
    mealMocks.getById.mockResolvedValue({
      id: "m1",
      totalKcal: 500,
      totalProteinG: 30,
      totalCarbsG: 50,
      totalFatG: 15,
    });
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post({
        mealId: "m1",
        mealSlot: "breakfast",
        servings: 2,
        loggedAt: "2026-06-21T08:00:00.000Z",
      }),
    );
    expect(res.status).toBe(201);
    expect(mealMocks.getById).toHaveBeenCalledWith("m1", "test-user-id");
    expect(entryMocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({
        kcal: 1000,
        proteinG: 60,
        carbsG: 100,
        fatG: 30,
      }),
    );
  });

  it("400s when the referenced meal is missing", async () => {
    mealMocks.getById.mockResolvedValue(null);
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post({
        mealId: "missing",
        mealSlot: "lunch",
        servings: 1,
        loggedAt: "2026-06-21T12:00:00.000Z",
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("meal_not_found");
  });

  it("400s when the referenced food is missing", async () => {
    foodMocks.getById.mockResolvedValue(null);
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post({
        foodId: "missing",
        mealSlot: "lunch",
        servings: 1,
        loggedAt: "2026-06-21T12:00:00.000Z",
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("food_not_found");
  });

  it("accepts client macros for a one-off (no reference)", async () => {
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post({
        mealSlot: "snack",
        servings: 1,
        kcal: 120,
        proteinG: 2,
        carbsG: 25,
        fatG: 1,
        loggedAt: "2026-06-21T15:00:00.000Z",
      }),
    );
    expect(res.status).toBe(201);
    expect(foodMocks.getById).not.toHaveBeenCalled();
    expect(entryMocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ kcal: 120 }),
    );
  });

  it("round-trips customName for a one-off entry", async () => {
    entryMocks.create.mockResolvedValue({
      ...created,
      foodId: null,
      customName: "Mum's lasagne",
    });
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post({
        mealSlot: "dinner",
        servings: 1,
        kcal: 450,
        proteinG: 25,
        carbsG: 40,
        fatG: 18,
        loggedAt: "2026-06-21T19:00:00.000Z",
        customName: "Mum's lasagne",
      }),
    );
    expect(res.status).toBe(201);
    expect(entryMocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ customName: "Mum's lasagne" }),
    );
    const body = (await res.json()) as any;
    expect(body.data.customName).toBe("Mum's lasagne");
  });

  it("persists customName as null when not supplied", async () => {
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    await nutritionEntriesCreateHandler.handle(
      post({
        mealSlot: "snack",
        servings: 1,
        kcal: 120,
        proteinG: 2,
        carbsG: 25,
        fatG: 1,
        loggedAt: "2026-06-21T15:00:00.000Z",
      }),
    );
    expect(entryMocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ customName: null }),
    );
  });

  it("400s a one-off with no macros", async () => {
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post({
        mealSlot: "dinner",
        servings: 1,
        loggedAt: "2026-06-21T19:00:00.000Z",
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe(
      "macros_required_for_custom_entry",
    );
  });

  it("rejects negative servings at validation (no row written)", async () => {
    const { nutritionEntriesCreateHandler } =
      await import("../nutritionEntriesCreateHandler");
    const res = await nutritionEntriesCreateHandler.handle(
      post({
        foodId: "f1",
        mealSlot: "breakfast",
        servings: -3,
        loggedAt: "2026-06-21T08:00:00.000Z",
      }),
    );
    expect(res.status).toBe(422); // Elysia body validation (minimum: 0)
    expect(entryMocks.create).not.toHaveBeenCalled();
  });
});
