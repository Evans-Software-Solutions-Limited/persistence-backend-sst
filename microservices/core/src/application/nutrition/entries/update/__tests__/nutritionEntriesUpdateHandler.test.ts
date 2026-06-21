/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const entryMocks = { update: vi.fn() };

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

function put(body: unknown, auth = true) {
  return new Request("http://localhost/nutrition/entries/e1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

describe("nutritionEntriesUpdateHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { nutritionEntriesUpdateHandler } =
      await import("../nutritionEntriesUpdateHandler");
    const res = await nutritionEntriesUpdateHandler.handle(
      put({ servings: 3 }, false),
    );
    expect(res.status).toBe(401);
  });

  it("updates an owned entry", async () => {
    entryMocks.update.mockResolvedValue({ id: "e1", servings: 3 });
    const { nutritionEntriesUpdateHandler } =
      await import("../nutritionEntriesUpdateHandler");
    const res = await nutritionEntriesUpdateHandler.handle(
      put({ servings: 3 }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.servings).toBe(3);
    expect(entryMocks.update).toHaveBeenCalledWith("e1", "test-user-id", {
      servings: 3,
    });
  });

  it("404s when the entry is missing or not owned", async () => {
    entryMocks.update.mockResolvedValue(null);
    const { nutritionEntriesUpdateHandler } =
      await import("../nutritionEntriesUpdateHandler");
    const res = await nutritionEntriesUpdateHandler.handle(put({ kcal: 1 }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe("entry_not_found");
  });
});
