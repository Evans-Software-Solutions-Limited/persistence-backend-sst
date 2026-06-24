/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const recipeMocks = { list: vi.fn() };

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

describe("recipesListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recipeMocks.list.mockResolvedValue([{ id: "r1" }]);
  });

  it("requires auth", async () => {
    const { recipesListHandler } = await import("../recipesListHandler");
    expect(
      (await recipesListHandler.handle(new Request("http://localhost/recipes")))
        .status,
    ).toBe(401);
  });

  it("returns the user's recipes", async () => {
    const { recipesListHandler } = await import("../recipesListHandler");
    const res = await recipesListHandler.handle(
      new Request("http://localhost/recipes", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toHaveLength(1);
    expect(recipeMocks.list).toHaveBeenCalledWith("test-user-id");
  });
});
