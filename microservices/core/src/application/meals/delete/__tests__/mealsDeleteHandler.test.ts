/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mealMocks = { delete: vi.fn() };

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

const del = (auth = true) =>
  new Request("http://localhost/meals/m1", {
    method: "DELETE",
    headers: auth ? { authorization: "Bearer token" } : {},
  });

describe("mealsDeleteHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { mealsDeleteHandler } = await import("../mealsDeleteHandler");
    expect((await mealsDeleteHandler.handle(del(false))).status).toBe(401);
  });

  it("deletes an owned meal", async () => {
    mealMocks.delete.mockResolvedValue(true);
    const { mealsDeleteHandler } = await import("../mealsDeleteHandler");
    const res = await mealsDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.deleted).toBe(true);
  });

  it("404s when nothing deleted", async () => {
    mealMocks.delete.mockResolvedValue(false);
    const { mealsDeleteHandler } = await import("../mealsDeleteHandler");
    expect((await mealsDeleteHandler.handle(del())).status).toBe(404);
  });
});
