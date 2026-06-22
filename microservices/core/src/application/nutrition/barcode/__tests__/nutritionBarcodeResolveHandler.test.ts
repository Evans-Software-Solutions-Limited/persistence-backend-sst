/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const foodMocks = { getByBarcode: vi.fn(), create: vi.fn() };

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
vi.mock("../../../repositories/foodRepository", () => ({
  FoodRepository: vi.fn().mockImplementation(() => foodMocks),
}));
// Keep OpenFoodFactsUnavailableError real (handler uses instanceof); mock only
// the network call.
vi.mock("../services/openFoodFacts", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, resolveBarcodeFromOFF: vi.fn() };
});
import {
  resolveBarcodeFromOFF,
  OpenFoodFactsUnavailableError,
} from "../services/openFoodFacts";

function post(code: string, auth = true) {
  return new Request("http://localhost/nutrition/barcode/resolve", {
    method: "POST",
    body: JSON.stringify({ code }),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

const food = { id: "f1", barcode: "123", kcal: 150 };

describe("nutritionBarcodeResolveHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { nutritionBarcodeResolveHandler } =
      await import("../nutritionBarcodeResolveHandler");
    expect(
      (await nutritionBarcodeResolveHandler.handle(post("123", false))).status,
    ).toBe(401);
  });

  it("returns the cached food without calling OFF", async () => {
    foodMocks.getByBarcode.mockResolvedValue(food);
    const { nutritionBarcodeResolveHandler } =
      await import("../nutritionBarcodeResolveHandler");
    const res = await nutritionBarcodeResolveHandler.handle(post("123"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.id).toBe("f1");
    expect(resolveBarcodeFromOFF).not.toHaveBeenCalled();
  });

  it("on a cache miss, fetches OFF, persists the food, and returns it", async () => {
    foodMocks.getByBarcode.mockResolvedValue(null);
    (resolveBarcodeFromOFF as any).mockResolvedValue({
      found: true,
      food: { name: "Oats", barcode: "123", kcal: 379 },
    });
    foodMocks.create.mockResolvedValue({ id: "f2", barcode: "123" });
    const { nutritionBarcodeResolveHandler } =
      await import("../nutritionBarcodeResolveHandler");
    const res = await nutritionBarcodeResolveHandler.handle(post("123"));
    expect(res.status).toBe(200);
    expect(foodMocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ source: "openfoodfacts", barcode: "123" }),
    );
  });

  it("404s when OFF has no such product", async () => {
    foodMocks.getByBarcode.mockResolvedValue(null);
    (resolveBarcodeFromOFF as any).mockResolvedValue({ found: false });
    const { nutritionBarcodeResolveHandler } =
      await import("../nutritionBarcodeResolveHandler");
    const res = await nutritionBarcodeResolveHandler.handle(post("999"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toBe("barcode_not_found");
  });

  it("503s when OFF is unavailable / rate-limited", async () => {
    foodMocks.getByBarcode.mockResolvedValue(null);
    (resolveBarcodeFromOFF as any).mockRejectedValue(
      new OpenFoodFactsUnavailableError("off_status_429"),
    );
    const { nutritionBarcodeResolveHandler } =
      await import("../nutritionBarcodeResolveHandler");
    const res = await nutritionBarcodeResolveHandler.handle(post("123"));
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error).toBe("food_db_unavailable");
  });
});
