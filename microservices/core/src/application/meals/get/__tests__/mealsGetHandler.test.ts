/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
vi.mock("../../../repositories/mealRepository", () => ({
  MealRepository: vi.fn().mockImplementation(() => mealMocks),
}));

const req = (auth = true) =>
  new Request("http://localhost/meals/m1", {
    headers: auth ? { authorization: "Bearer token" } : {},
  });

describe("mealsGetHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { mealsGetHandler } = await import("../mealsGetHandler");
    expect((await mealsGetHandler.handle(req(false))).status).toBe(401);
  });

  it("returns the meal", async () => {
    mealMocks.getById.mockResolvedValue({ id: "m1", name: "Lunch" });
    const { mealsGetHandler } = await import("../mealsGetHandler");
    const res = await mealsGetHandler.handle(req());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.id).toBe("m1");
  });

  it("404s when missing or not owned", async () => {
    mealMocks.getById.mockResolvedValue(null);
    const { mealsGetHandler } = await import("../mealsGetHandler");
    const res = await mealsGetHandler.handle(req());
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe("meal_not_found");
  });
});
