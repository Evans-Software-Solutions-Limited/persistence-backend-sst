/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const recipeMocks = { create: vi.fn() };
const foodMocks = { getByIds: vi.fn() };

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
vi.mock("../../../repositories/recipeRepository", () => ({
  RecipeRepository: vi.fn().mockImplementation(() => recipeMocks),
}));
vi.mock("../../../repositories/foodRepository", () => ({
  FoodRepository: vi.fn().mockImplementation(() => foodMocks),
}));

function post(body: unknown, auth = true) {
  return new Request("http://localhost/recipes", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

describe("recipesCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recipeMocks.create.mockResolvedValue({ id: "r1", name: "Bowl" });
  });

  it("requires auth", async () => {
    const { recipesCreateHandler } = await import("../recipesCreateHandler");
    expect(
      (
        await recipesCreateHandler.handle(
          post({ name: "x", servings: 1, ingredients: [] }, false),
        )
      ).status,
    ).toBe(401);
  });

  it("materialises totals from ingredient foods and 201s", async () => {
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
    const { recipesCreateHandler } = await import("../recipesCreateHandler");
    const res = await recipesCreateHandler.handle(
      post({
        name: "Bowl",
        servings: 2,
        ingredients: [{ foodId: "f1", quantity: 100, unit: "g", sortOrder: 0 }],
      }),
    );
    expect(res.status).toBe(201);
    expect(foodMocks.getByIds).toHaveBeenCalledWith(["f1"], "test-user-id");
    expect(recipeMocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ name: "Bowl", source: "manual" }),
      { kcal: 100, proteinG: 10, carbsG: 20, fatG: 5 },
    );
  });
});
