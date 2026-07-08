/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const entryMocks = { getById: vi.fn(), update: vi.fn() };
const foodMocks = { getById: vi.fn() };

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
vi.mock("../../../../repositories/foodRepository", () => ({
  FoodRepository: vi.fn().mockImplementation(() => foodMocks),
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
  beforeEach(() => {
    vi.clearAllMocks();
    entryMocks.update.mockImplementation(async (_id, _u, patch) => ({
      id: "e1",
      ...patch,
    }));
  });

  it("requires auth", async () => {
    const { nutritionEntriesUpdateHandler } =
      await import("../nutritionEntriesUpdateHandler");
    const res = await nutritionEntriesUpdateHandler.handle(
      put({ servings: 3 }, false),
    );
    expect(res.status).toBe(401);
  });

  it("404s when the entry is missing or not owned", async () => {
    entryMocks.getById.mockResolvedValue(null);
    const { nutritionEntriesUpdateHandler } =
      await import("../nutritionEntriesUpdateHandler");
    const res = await nutritionEntriesUpdateHandler.handle(put({ kcal: 1 }));
    expect(res.status).toBe(404);
    expect(entryMocks.update).not.toHaveBeenCalled();
  });

  it("re-derives macros from the food for a foodId entry, ignoring client macros", async () => {
    entryMocks.getById.mockResolvedValue({
      id: "e1",
      foodId: "f1",
      servings: 1,
    });
    foodMocks.getById.mockResolvedValue({
      id: "f1",
      kcal: 150,
      proteinG: 10,
      carbsG: 20,
      fatG: 5,
      servingSize: 100,
    });
    const { nutritionEntriesUpdateHandler } =
      await import("../nutritionEntriesUpdateHandler");
    const res = await nutritionEntriesUpdateHandler.handle(
      put({ servings: 2, kcal: 99999 }), // bogus client kcal must be ignored
    );
    expect(res.status).toBe(200);
    const patch = entryMocks.update.mock.calls[0][2];
    expect(patch.servings).toBe(2);
    expect(patch.kcal).toBe(300); // 150 × 2, NOT 99999
    expect(patch.proteinG).toBe(20);
  });

  it("trusts client macros for a one-off entry (no foodId)", async () => {
    entryMocks.getById.mockResolvedValue({
      id: "e1",
      foodId: null,
      servings: 1,
    });
    const { nutritionEntriesUpdateHandler } =
      await import("../nutritionEntriesUpdateHandler");
    await nutritionEntriesUpdateHandler.handle(put({ kcal: 120 }));
    expect(foodMocks.getById).not.toHaveBeenCalled();
    expect(entryMocks.update.mock.calls[0][2]).toEqual({ kcal: 120 });
  });

  it("updates customName when supplied", async () => {
    entryMocks.getById.mockResolvedValue({
      id: "e1",
      foodId: null,
      servings: 1,
    });
    const { nutritionEntriesUpdateHandler } =
      await import("../nutritionEntriesUpdateHandler");
    const res = await nutritionEntriesUpdateHandler.handle(
      put({ customName: "Leftover curry" }),
    );
    expect(res.status).toBe(200);
    expect(entryMocks.update.mock.calls[0][2]).toEqual({
      customName: "Leftover curry",
    });
    const body = (await res.json()) as any;
    expect(body.data.customName).toBe("Leftover curry");
  });

  it("does not null an existing customName when absent from the PATCH", async () => {
    entryMocks.getById.mockResolvedValue({
      id: "e1",
      foodId: null,
      servings: 1,
      customName: "Existing label",
    });
    const { nutritionEntriesUpdateHandler } =
      await import("../nutritionEntriesUpdateHandler");
    await nutritionEntriesUpdateHandler.handle(put({ kcal: 120 }));
    const patch = entryMocks.update.mock.calls[0][2];
    expect(patch).not.toHaveProperty("customName");
    expect(patch).toEqual({ kcal: 120 });
  });
});
