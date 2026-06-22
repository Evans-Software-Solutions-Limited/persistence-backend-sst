/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const recipeMocks = { delete: vi.fn() };

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

const del = (auth = true) =>
  new Request("http://localhost/recipes/r1", {
    method: "DELETE",
    headers: auth ? { authorization: "Bearer token" } : {},
  });

describe("recipesDeleteHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { recipesDeleteHandler } = await import("../recipesDeleteHandler");
    expect((await recipesDeleteHandler.handle(del(false))).status).toBe(401);
  });

  it("deletes an owned recipe", async () => {
    recipeMocks.delete.mockResolvedValue(true);
    const { recipesDeleteHandler } = await import("../recipesDeleteHandler");
    const res = await recipesDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.deleted).toBe(true);
  });

  it("404s when nothing deleted", async () => {
    recipeMocks.delete.mockResolvedValue(false);
    const { recipesDeleteHandler } = await import("../recipesDeleteHandler");
    expect((await recipesDeleteHandler.handle(del())).status).toBe(404);
  });
});
