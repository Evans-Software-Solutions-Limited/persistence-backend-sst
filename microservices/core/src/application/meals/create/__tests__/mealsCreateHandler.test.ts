/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mealMocks = { create: vi.fn() };
const foodMocks = { getByIds: vi.fn() };
const recipeMocks = { getMacroSummaries: vi.fn() };

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
vi.mock("../../../repositories/mealRepository", () => ({
  MealRepository: vi.fn().mockImplementation(() => mealMocks),
}));
vi.mock("../../../repositories/foodRepository", () => ({
  FoodRepository: vi.fn().mockImplementation(() => foodMocks),
}));
vi.mock("../../../repositories/recipeRepository", () => ({
  RecipeRepository: vi.fn().mockImplementation(() => recipeMocks),
}));

function post(body: unknown, auth = true) {
  return new Request("http://localhost/meals", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

describe("mealsCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mealMocks.create.mockResolvedValue({ id: "m1", name: "Lunch" });
    recipeMocks.getMacroSummaries.mockResolvedValue(new Map());
  });

  it("requires auth", async () => {
    const { mealsCreateHandler } = await import("../mealsCreateHandler");
    expect(
      (await mealsCreateHandler.handle(post({ name: "x", items: [] }, false)))
        .status,
    ).toBe(401);
  });

  it("materialises totals from foods + recipes and 201s", async () => {
    foodMocks.getByIds.mockResolvedValue([
      {
        id: "f1",
        kcal: 100,
        proteinG: 10,
        carbsG: 20,
        fatG: 5,
        servingSize: 100,
      },
    ]);
    const { mealsCreateHandler } = await import("../mealsCreateHandler");
    const res = await mealsCreateHandler.handle(
      post({
        name: "Lunch",
        items: [{ foodId: "f1", servings: 2, sortOrder: 0 }],
      }),
    );
    expect(res.status).toBe(201);
    expect(foodMocks.getByIds).toHaveBeenCalledWith(["f1"]);
    expect(recipeMocks.getMacroSummaries).toHaveBeenCalledWith(
      [],
      "test-user-id",
    );
    expect(mealMocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ name: "Lunch" }),
      { kcal: 200, proteinG: 20, carbsG: 40, fatG: 10 },
    );
  });
});
