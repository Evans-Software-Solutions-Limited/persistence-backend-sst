/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const entryMocks = { listByDate: vi.fn() };

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

vi.mock("../../../../repositories/nutritionEntryRepository", () => ({
  NutritionEntryRepository: vi.fn().mockImplementation(() => entryMocks),
}));

describe("nutritionEntriesListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entryMocks.listByDate.mockResolvedValue([{ id: "e1", kcal: 300 }]);
  });

  it("requires auth", async () => {
    const { nutritionEntriesListHandler } =
      await import("../nutritionEntriesListHandler");
    const res = await nutritionEntriesListHandler.handle(
      new Request("http://localhost/nutrition/entries?date=2026-06-21"),
    );
    expect(res.status).toBe(401);
  });

  it("returns the day's entries for the user", async () => {
    const { nutritionEntriesListHandler } =
      await import("../nutritionEntriesListHandler");
    const res = await nutritionEntriesListHandler.handle(
      new Request("http://localhost/nutrition/entries?date=2026-06-21", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toHaveLength(1);
    expect(entryMocks.listByDate).toHaveBeenCalledWith(
      "test-user-id",
      "2026-06-21",
    );
  });
});
