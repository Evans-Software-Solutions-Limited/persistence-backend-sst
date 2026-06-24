/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const foodMocks = { create: vi.fn() };

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
vi.mock("../../../repositories/foodRepository", () => ({
  FoodRepository: vi.fn().mockImplementation(() => foodMocks),
}));

const valid = {
  name: "Homemade granola",
  kcal: 480,
  proteinG: 12,
  carbsG: 60,
  fatG: 20,
  servingSize: 100,
  servingUnit: "g",
};

function post(body: unknown, auth = true) {
  return new Request("http://localhost/foods", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

describe("foodsCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    foodMocks.create.mockResolvedValue({ id: "f1", ...valid, source: "user" });
  });

  it("requires auth", async () => {
    const { foodsCreateHandler } = await import("../foodsCreateHandler");
    expect((await foodsCreateHandler.handle(post(valid, false))).status).toBe(
      401,
    );
  });

  it("creates a user-sourced food and 201s", async () => {
    const { foodsCreateHandler } = await import("../foodsCreateHandler");
    const res = await foodsCreateHandler.handle(post(valid));
    expect(res.status).toBe(201);
    expect(foodMocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ name: "Homemade granola", source: "user" }),
    );
  });
});
