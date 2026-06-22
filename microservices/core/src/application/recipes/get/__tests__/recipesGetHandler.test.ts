/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const recipeMocks = { getById: vi.fn() };

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

const req = (auth = true) =>
  new Request("http://localhost/recipes/r1", {
    headers: auth ? { authorization: "Bearer token" } : {},
  });

describe("recipesGetHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { recipesGetHandler } = await import("../recipesGetHandler");
    expect((await recipesGetHandler.handle(req(false))).status).toBe(401);
  });

  it("returns the recipe", async () => {
    recipeMocks.getById.mockResolvedValue({ id: "r1", name: "Bowl" });
    const { recipesGetHandler } = await import("../recipesGetHandler");
    const res = await recipesGetHandler.handle(req());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.id).toBe("r1");
  });

  it("404s when missing or not owned", async () => {
    recipeMocks.getById.mockResolvedValue(null);
    const { recipesGetHandler } = await import("../recipesGetHandler");
    const res = await recipesGetHandler.handle(req());
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe("recipe_not_found");
  });
});
