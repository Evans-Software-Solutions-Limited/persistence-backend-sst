/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mealMocks = { update: vi.fn() };

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

function put(body: unknown, auth = true) {
  return new Request("http://localhost/meals/m1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

describe("mealsUpdateHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { mealsUpdateHandler } = await import("../mealsUpdateHandler");
    expect(
      (await mealsUpdateHandler.handle(put({ name: "x" }, false))).status,
    ).toBe(401);
  });

  it("updates and returns the meal", async () => {
    mealMocks.update.mockResolvedValue({ id: "m1", name: "New" });
    const { mealsUpdateHandler } = await import("../mealsUpdateHandler");
    const res = await mealsUpdateHandler.handle(put({ name: "New" }));
    expect(res.status).toBe(200);
    expect(mealMocks.update).toHaveBeenCalledWith("m1", "test-user-id", {
      name: "New",
    });
  });

  it("404s when not owned", async () => {
    mealMocks.update.mockResolvedValue(null);
    const { mealsUpdateHandler } = await import("../mealsUpdateHandler");
    expect((await mealsUpdateHandler.handle(put({ name: "x" }))).status).toBe(
      404,
    );
  });
});
