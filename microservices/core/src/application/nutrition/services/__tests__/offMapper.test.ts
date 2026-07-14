import { describe, it, expect } from "vitest";
import {
  mapOffProductToFood,
  mapOffBatch,
  type OffProduct,
} from "../offMapper";

const complete: OffProduct = {
  code: "5000159484695",
  product_name: "Oats",
  brands: "Quaker",
  countries_tags: ["en:united-kingdom", "en:france"],
  serving_quantity: 40,
  nutriments: {
    "energy-kcal_100g": 379,
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
