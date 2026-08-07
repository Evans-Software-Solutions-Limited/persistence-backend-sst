import { describe, it, expect } from "vitest";
import {
  mapOffProductToFood,
  mapOffBatch,
  mapOffAllergenTags,
  normaliseOffTags,
  type OffProduct,
} from "../offMapper";

const complete: OffProduct = {
  code: "5000159484695",
  product_name: "Oats",
  brands: "Quaker",
  countries_tags: ["en:united-kingdom", "en:france"],
  serving_quantity: 40,
  allergens_tags: ["en:gluten"],
  categories_tags: ["en:breakfast-cereals", "en:oat-flakes"],
  ingredients_text: "Wholegrain rolled oats",
  nutriments: {
    "energy-kcal_100g": 379,
    "energy-kj_100g": 1585,
    proteins_100g: 13,
    carbohydrates_100g: 67,
    fat_100g: 8,
  },
};

describe("mapOffProductToFood", () => {
  it("maps a complete product to a per-100g food row with the real serving", () => {
    expect(mapOffProductToFood(complete)).toEqual({
      barcode: "5000159484695",
      name: "Oats",
      brand: "Quaker",
      kcal: 379,
      proteinG: 13,
      carbsG: 67,
      fatG: 8,
      servingSize: 100,
      servingUnit: "g",
      servingQuantity: 40,
      allergenTags: ["en:gluten"],
      categoryTags: ["en:breakfast-cereals", "en:oat-flakes"],
      localeTags: ["en:united-kingdom", "en:france"],
      nutritionDataValid: true,
      nutritionDataIssue: null,
      source: "openfoodfacts",
    });
  });

  it("carries a null servingQuantity when serving_quantity is absent / non-positive", () => {
    expect(
      mapOffProductToFood({ ...complete, serving_quantity: undefined })
        ?.servingQuantity,
    ).toBeNull();
    expect(
      mapOffProductToFood({ ...complete, serving_quantity: 0 })
        ?.servingQuantity,
    ).toBeNull();
  });

  it("seeds a kJ-only product via the kcal fallback (÷4.184)", () => {
    const r = mapOffProductToFood({
      ...complete,
      nutriments: {
        "energy-kj_100g": 1000,
        proteins_100g: 13,
        carbohydrates_100g: 67,
        fat_100g: 8,
      },
    });
    expect(r?.kcal).toBe(239);
  });

  it("coerces numeric strings (OFF often stores nutriments as strings)", () => {
    const r = mapOffProductToFood({
      ...complete,
      nutriments: {
        "energy-kcal_100g": "379",
        proteins_100g: "13",
        carbohydrates_100g: "67",
        fat_100g: "8",
      },
    });
    expect(r?.kcal).toBe(379);
  });

  it("stores the kJ-derived value but quarantines contradictory OFF energy", () => {
    const row = mapOffProductToFood({
      ...complete,
      nutriments: {
        "energy-kcal_100g": 2.4,
        "energy-kj_100g": 850.6,
        proteins_100g: 23,
        carbohydrates_100g: 59,
        fat_100g: 5,
      },
    });
    expect(row).toMatchObject({
      kcal: 203.3,
      nutritionDataValid: false,
      nutritionDataIssue: "energy_mismatch",
    });
  });

  it("rejects products without a barcode or name", () => {
    expect(mapOffProductToFood({ ...complete, code: undefined })).toBeNull();
    expect(mapOffProductToFood({ ...complete, product_name: "  " })).toBeNull();
  });

  it("rejects incomplete or negative macros", () => {
    expect(
      mapOffProductToFood({
        ...complete,
        nutriments: { "energy-kcal_100g": 379, proteins_100g: 13 },
      }),
    ).toBeNull();
    expect(
      mapOffProductToFood({
        ...complete,
        nutriments: { ...complete.nutriments, fat_100g: -1 },
      }),
    ).toBeNull();
  });

  it("applies the locale allow-list when provided", () => {
    expect(
      mapOffProductToFood(complete, { countriesAllow: ["en:united-kingdom"] }),
    ).not.toBeNull();
    expect(
      mapOffProductToFood(complete, { countriesAllow: ["en:germany"] }),
    ).toBeNull();
  });

  it("mapOffBatch drops the rows that don't pass", () => {
    const out = mapOffBatch([complete, { code: undefined }, complete]);
    expect(out).toHaveLength(2);
  });
});

// ── Mealprint (spec-26 § 2.1) tag projection ────────────────────────────────

describe("normaliseOffTags", () => {
  it("trims, lowercases, dedupes and preserves order", () => {
    expect(normaliseOffTags([" EN:Milk ", "en:milk", "en:Gluten"])).toEqual([
      "en:milk",
      "en:gluten",
    ]);
  });

  it("returns null — not [] — for absent, non-array or all-empty input", () => {
    // The distinction is load-bearing: null round-trips to SQL NULL = unknown,
    // which avoidanceFilter treats as unsafe. `[]` is a positive claim.
    expect(normaliseOffTags(undefined)).toBeNull();
    expect(normaliseOffTags(null)).toBeNull();
    expect(normaliseOffTags([])).toBeNull();
    expect(normaliseOffTags(["", "   "])).toBeNull();
  });

  it("skips non-string members without discarding the rest", () => {
    expect(
      normaliseOffTags(["en:milk", 42 as unknown as string, "en:eggs"]),
    ).toEqual(["en:milk", "en:eggs"]);
  });

  it("keeps NON-en tags rather than filtering to the taxonomy prefix", () => {
    // Dropping `fr:lait` here would destroy the only evidence that a product
    // contains milk. Interpretation is avoidanceFilter's job, not this module's.
    expect(normaliseOffTags(["fr:lait", "en:gluten"])).toEqual([
      "fr:lait",
      "en:gluten",
    ]);
  });
});

describe("mapOffAllergenTags", () => {
  it("returns the declared tags when OFF has any", () => {
    expect(
      mapOffAllergenTags({ allergens_tags: ["en:milk"], ingredients_text: "" }),
    ).toEqual(["en:milk"]);
  });

  it("returns [] when ingredients WERE analysed and no allergen was found", () => {
    // A real, weaker-but-usable signal — the label-check disclaimer (AC 1.2)
    // covers the residual risk.
    expect(
      mapOffAllergenTags({
        allergens_tags: [],
        ingredients_text: "Chicken breast",
      }),
    ).toEqual([]);
  });

  it("returns NULL when no ingredient data exists — never [] (AC 2.2)", () => {
    // THE safety-critical case. Conflating this with the above would make every
    // un-analysed OFF row read as "allergen-free" and hand a peanut-avoiding
    // user products nobody has examined.
    expect(mapOffAllergenTags({ allergens_tags: [] })).toBeNull();
    expect(mapOffAllergenTags({})).toBeNull();
    expect(mapOffAllergenTags({ ingredients_text: "   " })).toBeNull();
  });

  it("prefers declared tags over the ingredients heuristic", () => {
    expect(mapOffAllergenTags({ allergens_tags: ["en:peanuts"] })).toEqual([
      "en:peanuts",
    ]);
  });
});

describe("mapOffProductToFood — tag columns", () => {
  it("maps an un-analysed product to NULL allergen tags, not empty", () => {
    const row = mapOffProductToFood({
      ...complete,
      allergens_tags: undefined,
      ingredients_text: undefined,
    });
    expect(row?.allergenTags).toBeNull();
  });

  it("maps an analysed, allergen-free product to []", () => {
    const row = mapOffProductToFood({
      ...complete,
      allergens_tags: [],
      ingredients_text: "Chicken breast (100%)",
    });
    expect(row?.allergenTags).toEqual([]);
  });

  it("nulls category and locale tags when OFF omits them", () => {
    const row = mapOffProductToFood({
      ...complete,
      categories_tags: undefined,
      countries_tags: undefined,
    });
    expect(row?.categoryTags).toBeNull();
    expect(row?.localeTags).toBeNull();
  });

  it("a row that passed the locale filter always carries the tag that let it through", () => {
    const row = mapOffProductToFood(complete, {
      countriesAllow: ["en:united-kingdom"],
    });
    expect(row?.localeTags).toContain("en:united-kingdom");
  });
});
