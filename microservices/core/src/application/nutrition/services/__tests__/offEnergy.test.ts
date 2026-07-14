import { describe, it, expect } from "vitest";
import { kcalFromOffNutriments } from "../offEnergy";

describe("kcalFromOffNutriments", () => {
  it("prefers energy-kcal_100g when present", () => {
    expect(
      kcalFromOffNutriments({
        "energy-kcal_100g": 379,
        "energy-kj_100g": 1585,
      }),
    ).toBe(379);
  });

  it("parses a numeric-string kcal", () => {
    expect(kcalFromOffNutriments({ "energy-kcal_100g": "250" })).toBe(250);
  });

  it("falls back to energy-kj_100g (÷4.184) when kcal is absent", () => {
    // 1000 kJ / 4.184 = 239.006… → 239 (1 dp)
    expect(kcalFromOffNutriments({ "energy-kj_100g": 1000 })).toBe(239);
    // 1570 kJ → 375.2
    expect(kcalFromOffNutriments({ "energy-kj_100g": 1570 })).toBe(375.2);
  });

  it("falls back to the generic energy_100g (kJ by OFF convention)", () => {
    expect(kcalFromOffNutriments({ energy_100g: 1000 })).toBe(239);
  });

  it("prefers the explicit kj field over the generic energy field", () => {
    expect(
      kcalFromOffNutriments({ "energy-kj_100g": 1000, energy_100g: 2000 }),
    ).toBe(239);
  });

  it("returns null when no energy figure is present", () => {
    expect(kcalFromOffNutriments({ proteins_100g: 10 })).toBeNull();
    expect(kcalFromOffNutriments({})).toBeNull();
    expect(kcalFromOffNutriments(undefined)).toBeNull();
    expect(kcalFromOffNutriments(null)).toBeNull();
  });

  it("treats a negative energy as absent (malformed OFF data)", () => {
    expect(kcalFromOffNutriments({ "energy-kcal_100g": -5 })).toBeNull();
    expect(kcalFromOffNutriments({ "energy-kj_100g": -100 })).toBeNull();
  });

  it("keeps a legitimate zero-kcal product (water / diet drink)", () => {
    expect(kcalFromOffNutriments({ "energy-kcal_100g": 0 })).toBe(0);
  });

  it("ignores empty-string / non-numeric energy values", () => {
    expect(
      kcalFromOffNutriments({ "energy-kcal_100g": "", "energy-kj_100g": "x" }),
    ).toBeNull();
  });
});
