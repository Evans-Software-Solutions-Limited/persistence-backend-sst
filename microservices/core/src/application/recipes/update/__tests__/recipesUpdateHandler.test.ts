/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const recipeMocks = { update: vi.fn() };

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

function put(body: unknown, auth = true) {
  return new Request("http://localhost/recipes/r1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

describe("recipesUpdateHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { recipesUpdateHandler } = await import("../recipesUpdateHandler");
    expect(
      (await recipesUpdateHandler.handle(put({ name: "x" }, false))).status,
    ).toBe(401);
  });

  it("updates and returns the recipe", async () => {
    recipeMocks.update.mockResolvedValue({ id: "r1", name: "New" });
    const { recipesUpdateHandler } = await import("../recipesUpdateHandler");
    const res = await recipesUpdateHandler.handle(put({ name: "New" }));
    expect(res.status).toBe(200);
    expect(recipeMocks.update).toHaveBeenCalledWith("r1", "test-user-id", {
      name: "New",
    });
  });

  it("404s when not owned", async () => {
    recipeMocks.update.mockResolvedValue(null);
    const { recipesUpdateHandler } = await import("../recipesUpdateHandler");
    expect((await recipesUpdateHandler.handle(put({ name: "x" }))).status).toBe(
      404,
    );
  });
});
