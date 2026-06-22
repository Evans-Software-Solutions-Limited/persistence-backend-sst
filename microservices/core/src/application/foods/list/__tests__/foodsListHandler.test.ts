/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const foodMocks = { search: vi.fn() };

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

describe("foodsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    foodMocks.search.mockResolvedValue([{ id: "f1" }]);
  });

  it("requires auth", async () => {
    const { foodsListHandler } = await import("../foodsListHandler");
    const res = await foodsListHandler.handle(
      new Request("http://localhost/foods?query=oat"),
    );
    expect(res.status).toBe(401);
  });

  it("searches scoped to the user + global library", async () => {
    const { foodsListHandler } = await import("../foodsListHandler");
    const res = await foodsListHandler.handle(
      new Request("http://localhost/foods?query=oat", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toHaveLength(1);
    expect(foodMocks.search).toHaveBeenCalledWith("oat", "test-user-id");
  });
});
