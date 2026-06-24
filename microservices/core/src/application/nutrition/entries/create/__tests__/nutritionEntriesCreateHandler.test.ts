/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const entryMocks = { create: vi.fn() };
const foodMocks = { getById: vi.fn() };

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
