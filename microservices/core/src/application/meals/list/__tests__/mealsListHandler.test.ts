/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mealMocks = { list: vi.fn() };

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

describe("mealsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mealMocks.list.mockResolvedValue([{ id: "m1" }]);
  });

  it("requires auth", async () => {
    const { mealsListHandler } = await import("../mealsListHandler");
    expect(
      (await mealsListHandler.handle(new Request("http://localhost/meals")))
        .status,
    ).toBe(401);
  });

  it("returns the user's meals", async () => {
    const { mealsListHandler } = await import("../mealsListHandler");
    const res = await mealsListHandler.handle(
      new Request("http://localhost/meals", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toHaveLength(1);
    expect(mealMocks.list).toHaveBeenCalledWith("test-user-id");
  });
});
