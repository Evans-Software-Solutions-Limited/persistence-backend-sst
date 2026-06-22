import { describe, it, expect } from "vitest";
import {
  mapOffProduct,
  resolveBarcodeFromOFF,
  OpenFoodFactsUnavailableError,
} from "../services/openFoodFacts";

const product = {
  product_name: "Porridge Oats",
  brands: "Quaker, PepsiCo",
  nutriments: {
    "energy-kcal_100g": 379,
    proteins_100g: 11,
    carbohydrates_100g: 67,
    fat_100g: 8,
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("mapOffProduct", () => {
  it("maps a product on a per-100g basis, taking the first brand", () => {
    const out = mapOffProduct("123", product);
    expect(out).toEqual({
      name: "Porridge Oats",
      brand: "Quaker",
      barcode: "123",
      kcal: 379,
      proteinG: 11,
      carbsG: 67,
      fatG: 8,
      servingSize: 100,
      servingUnit: "g",
    });
  });

  it("returns null when energy-kcal_100g is absent (can't persist NOT NULL kcal)", () => {
    expect(
      mapOffProduct("123", { product_name: "x", nutriments: {} }),
    ).toBeNull();
  });

  it("defaults missing macros to 0 and name to a placeholder", () => {
    const out = mapOffProduct("123", {
      nutriments: { "energy-kcal_100g": 100 },
    });
    expect(out?.proteinG).toBe(0);
    expect(out?.name).toBe("Unknown product");
    expect(out?.brand).toBeNull();
  });
});

describe("resolveBarcodeFromOFF", () => {
  it("resolves a found product", async () => {
    const res = await resolveBarcodeFromOFF("123", {
      fetcher: async () => jsonResponse({ status: 1, product }),
    });
    expect(res.found).toBe(true);
    if (res.found) expect(res.food.kcal).toBe(379);
  });

  it("treats OFF status 0 as not found", async () => {
    const res = await resolveBarcodeFromOFF("123", {
      fetcher: async () => jsonResponse({ status: 0 }),
    });
    expect(res.found).toBe(false);
  });

  it("treats HTTP 404 as not found", async () => {
    const res = await resolveBarcodeFromOFF("123", {
      fetcher: async () => new Response("", { status: 404 }),
    });
    expect(res.found).toBe(false);
  });

  it("throws Unavailable on 429 (no retry → no IP-ban risk)", async () => {
    await expect(
      resolveBarcodeFromOFF("123", {
        fetcher: async () => new Response("", { status: 429 }),
      }),
    ).rejects.toBeInstanceOf(OpenFoodFactsUnavailableError);
  });

  it("throws Unavailable on 5xx", async () => {
    await expect(
      resolveBarcodeFromOFF("123", {
        fetcher: async () => new Response("", { status: 503 }),
      }),
    ).rejects.toBeInstanceOf(OpenFoodFactsUnavailableError);
  });

  it("throws Unavailable on a network/timeout error", async () => {
    await expect(
      resolveBarcodeFromOFF("123", {
        fetcher: async () => {
          throw new Error("network down");
        },
      }),
    ).rejects.toBeInstanceOf(OpenFoodFactsUnavailableError);
  });

  it("found:false when product missing essential macros", async () => {
    const res = await resolveBarcodeFromOFF("123", {
      fetcher: async () =>
        jsonResponse({ status: 1, product: { nutriments: {} } }),
    });
    expect(res.found).toBe(false);
  });
});
