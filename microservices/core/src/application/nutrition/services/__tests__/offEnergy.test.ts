import { describe, it, expect } from "vitest";
import { kcalFromOffNutriments, resolveOffEnergy } from "../offEnergy";

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

describe("resolveOffEnergy", () => {
  it("accepts kcal and kJ values that agree", () => {
    expect(
      resolveOffEnergy({ "energy-kcal_100g": 379, "energy-kj_100g": 1585 }),
    ).toEqual({
      kcal: 379,
      nutritionDataValid: true,
      nutritionDataIssue: null,
    });
  });

  it.each([
    [2.4, 850.6, 203.3],
    [9.49, 1494.3, 357.1],
    [2, 1220.4, 291.7],
  ])("quarantines the audited kcal/kJ contradiction", (kcal, kj, expected) => {
    expect(
      resolveOffEnergy({
        "energy-kcal_100g": kcal,
        "energy-kj_100g": kj,
      }),
    ).toEqual({
      kcal: expected,
      nutritionDataValid: false,
      nutritionDataIssue: "energy_mismatch",
    });
  });

  it("quarantines a kcal-only gross macro contradiction", () => {
    expect(
      resolveOffEnergy(
        { "energy-kcal_100g": 5 },
        { proteinG: 23, carbsG: 59, fatG: 5 },
      ),
    ).toEqual({
      kcal: 5,
      nutritionDataValid: false,
      nutritionDataIssue: "macro_energy_mismatch",
    });
  });

  it("honours OFF's energy mismatch quality signals", () => {
    expect(
      resolveOffEnergy(
        { "energy-kcal_100g": 100, "energy-kj_100g": 418.4 },
        {
          qualityTags: [
            "en:nutrition-energy-value-in-kcal-does-not-match-value-in-kj",
          ],
        },
      ).nutritionDataIssue,
    ).toBe("off_quality_flag");
  });

  it("does not quarantine OFF's broad computed-energy warning by itself", () => {
    expect(
      resolveOffEnergy(
        { "energy-kcal_100g": 100 },
        {
          proteinG: 10,
          carbsG: 10,
          fatG: 2,
          qualityTags: [
            "en:nutrition-energy-value-in-kcal-does-not-match-value-computed-from-other-nutrients",
          ],
        },
      ).nutritionDataValid,
    ).toBe(true);
  });

  it("uses a valid alternate field but quarantines a malformed negative", () => {
    expect(
      resolveOffEnergy({
        "energy-kcal_100g": -1,
        "energy-kj_100g": 418.4,
      }),
    ).toEqual({
      kcal: 100,
      nutritionDataValid: false,
      nutritionDataIssue: "energy_mismatch",
    });
  });
});
