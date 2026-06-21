/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const entryMocks = { delete: vi.fn() };

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

function del(auth = true) {
  return new Request("http://localhost/nutrition/entries/e1", {
    method: "DELETE",
    headers: auth ? { authorization: "Bearer token" } : {},
  });
}

describe("nutritionEntriesDeleteHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { nutritionEntriesDeleteHandler } =
      await import("../nutritionEntriesDeleteHandler");
    expect(
      (await nutritionEntriesDeleteHandler.handle(del(false))).status,
    ).toBe(401);
  });

  it("deletes an owned entry", async () => {
    entryMocks.delete.mockResolvedValue(true);
    const { nutritionEntriesDeleteHandler } =
      await import("../nutritionEntriesDeleteHandler");
    const res = await nutritionEntriesDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.deleted).toBe(true);
    expect(entryMocks.delete).toHaveBeenCalledWith("e1", "test-user-id");
  });

  it("404s when nothing was deleted", async () => {
    entryMocks.delete.mockResolvedValue(false);
    const { nutritionEntriesDeleteHandler } =
      await import("../nutritionEntriesDeleteHandler");
    const res = await nutritionEntriesDeleteHandler.handle(del());
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe("entry_not_found");
  });
});
