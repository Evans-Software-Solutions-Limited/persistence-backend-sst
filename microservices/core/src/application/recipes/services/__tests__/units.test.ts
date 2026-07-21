import { describe, it, expect } from "vitest";
import { toGrams, servingScaleFactor } from "../units";

describe("toGrams", () => {
  it("converts recognised mass units (case/whitespace/plural/trailing-dot insensitive)", () => {
    expect(toGrams(100, "g")).toBe(100);
    expect(toGrams(2, "kg")).toBe(2000);
    expect(toGrams(1, " Grams ")).toBe(1);
    expect(toGrams(1, "KG")).toBe(1000);
    expect(toGrams(1, "lb")).toBeCloseTo(453.59237, 5);
    expect(toGrams(8, "oz")).toBeCloseTo(226.796185, 5);
    expect(toGrams(1, "oz.")).toBeCloseTo(28.349523125, 5);
  });

  it("returns null for volume, count, unknown, empty, or absent units", () => {
    expect(toGrams(2, "cups")).toBeNull();
    expect(toGrams(1, "ml")).toBeNull();
    expect(toGrams(3, "piece")).toBeNull();
    expect(toGrams(1, "")).toBeNull();
    expect(toGrams(1, null)).toBeNull();
    expect(toGrams(1, undefined)).toBeNull();
  });
});

describe("servingScaleFactor", () => {
  it("scales exactly across mass units (kg ingredient vs g serving)", () => {
    // 0.5 kg against a per-100g food = 5 servings — the case the naive
    // quantity/servingSize got wrong (it would have returned 0.005).
    expect(servingScaleFactor(0.5, "kg", 100, "g")).toBe(5);
    expect(servingScaleFactor(8, "oz", 100, "g")).toBeCloseTo(2.26796, 4);
  });

  it("falls back to quantity/servingSize when units aren't both mass", () => {
    // Volume ingredient — no density, so fall back.
    expect(servingScaleFactor(2, "cups", 100, "g")).toBe(0.02);
    // Unitless quantity = "N servings of the food".
    expect(servingScaleFactor(3, "", 1, "serving")).toBe(3);
    // Same-grams path still equals the fallback for a per-100g food + grams.
    expect(servingScaleFactor(200, "g", 100, "g")).toBe(2);
  });

  it("returns 0 for a non-positive serving size", () => {
    expect(servingScaleFactor(100, "g", 0, "g")).toBe(0);
    expect(servingScaleFactor(100, "g", -5, "g")).toBe(0);
  });

  it("falls back when the food serving unit is a mass unit but the ingredient isn't", () => {
    expect(servingScaleFactor(2, "cups", 100, "g")).toBe(0.02);
  });
});
