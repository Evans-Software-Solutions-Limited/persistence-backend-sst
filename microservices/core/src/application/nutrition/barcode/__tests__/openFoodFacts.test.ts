import { describe, it, expect } from "vitest";
import {
  mapOffProduct,
  resolveBarcodeFromOFF,
  OpenFoodFactsUnavailableError,
} from "../services/openFoodFacts";

const product = {
  product_name: "Porridge Oats",
  brands: "Quaker, PepsiCo",
  serving_quantity: 40,
  allergens_tags: ["en:gluten"],
  categories_tags: ["en:breakfast-cereals"],
  countries_tags: ["en:united-kingdom"],
  ingredients_text: "Wholegrain rolled oats",
  nutriments: {
    "energy-kcal_100g": 379,
    "energy-kj_100g": 1585,
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
  it("maps a product per-100g, taking the first brand + the real serving", () => {
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
      servingQuantity: 40,
      allergenTags: ["en:gluten"],
      categoryTags: ["en:breakfast-cereals"],
      localeTags: ["en:united-kingdom"],
      nutritionDataValid: true,
      nutritionDataIssue: null,
    });
  });

  // Mealprint (spec-26 § 2.1). The live resolve path WRITES `foods` rows, so it
  // has to carry tags for the same reason the bulk seed does — otherwise every
  // barcode a user scans lands unknown and is excluded from allergen-filtered
  // candidate pools. It reuses `offMapper`'s functions so the two paths cannot
  // drift on the null-vs-empty encoding.
  it("maps an un-analysed product to NULL allergen tags, not empty", () => {
    const out = mapOffProduct("123", {
      ...product,
      allergens_tags: undefined,
      ingredients_text: undefined,
    });
    expect(out?.allergenTags).toBeNull();
  });

  it("maps an analysed, allergen-free product to []", () => {
    const out = mapOffProduct("123", {
      ...product,
      allergens_tags: [],
      ingredients_text: "Chicken breast (100%)",
    });
    expect(out?.allergenTags).toEqual([]);
  });

  it("returns null when no energy figure is present (can't persist NOT NULL kcal)", () => {
    expect(
      mapOffProduct("123", { product_name: "x", nutriments: {} }),
    ).toBeNull();
  });

  it("resolves a kJ-only product via the kcal fallback (÷4.184)", () => {
    const out = mapOffProduct("123", {
      product_name: "kJ only",
      nutriments: { "energy-kj_100g": 1000, proteins_100g: 5 },
    });
    expect(out?.kcal).toBe(239);
    expect(out?.proteinG).toBe(5);
  });

  it("quarantines contradictory energy instead of resolving it", async () => {
    const contradictory = {
      ...product,
      nutriments: {
        "energy-kcal_100g": 2.4,
        "energy-kj_100g": 850.6,
        proteins_100g: 23,
        carbohydrates_100g: 59,
        fat_100g: 5,
      },
    };
    const res = await resolveBarcodeFromOFF("01851960", {
      fetcher: async () => jsonResponse({ status: 1, product: contradictory }),
    });
    expect(res.found).toBe(false);
    if (!res.found) {
      expect(res.invalidFood).toMatchObject({
        kcal: 203.3,
        nutritionDataValid: false,
        nutritionDataIssue: "energy_mismatch",
      });
    }
  });

  it("carries a null servingQuantity when OFF omits serving_quantity", () => {
    const out = mapOffProduct("123", {
      nutriments: { "energy-kcal_100g": 100 },
    });
    expect(out?.servingQuantity).toBeNull();
  });

  it("treats a zero / negative serving_quantity as null", () => {
    expect(
      mapOffProduct("123", {
        serving_quantity: 0,
        nutriments: { "energy-kcal_100g": 100 },
      })?.servingQuantity,
    ).toBeNull();
    expect(
      mapOffProduct("123", {
        serving_quantity: -5,
        nutriments: { "energy-kcal_100g": 100 },
      })?.servingQuantity,
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

  it("throws Unavailable on a 2xx with a non-JSON body (captive portal / proxy)", async () => {
    await expect(
      resolveBarcodeFromOFF("123", {
        fetcher: async () =>
          new Response("<html>not json</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      }),
    ).rejects.toBeInstanceOf(OpenFoodFactsUnavailableError);
  });
});
