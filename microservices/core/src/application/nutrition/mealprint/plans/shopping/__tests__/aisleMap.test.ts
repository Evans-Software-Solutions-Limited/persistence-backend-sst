import { describe, it, expect } from "vitest";
import { mapCategoryTagsToAisle, SHOPPING_AISLES } from "../aisleMap";

describe("mapCategoryTagsToAisle", () => {
  it("declares the fixed rendering order", () => {
    expect(SHOPPING_AISLES).toEqual([
      "Meat & fish",
      "Dairy & eggs",
      "Fruit & veg",
      "Bakery",
      "Cupboard",
      "Other",
    ]);
  });

  it.each([
    ["en:meats", "Meat & fish"],
    ["en:poultry", "Meat & fish"],
    ["en:fishes", "Meat & fish"],
    ["en:seafood", "Meat & fish"],
    ["en:chicken-breasts", "Meat & fish"],
  ] as const)("maps %s to %s", (tag, aisle) => {
    expect(mapCategoryTagsToAisle([tag])).toBe(aisle);
  });

  it.each([
    ["en:dairies", "Dairy & eggs"],
    ["en:milks", "Dairy & eggs"],
    ["en:cheeses", "Dairy & eggs"],
    ["en:yogurts", "Dairy & eggs"],
    ["en:eggs", "Dairy & eggs"],
  ] as const)("maps %s to %s", (tag, aisle) => {
    expect(mapCategoryTagsToAisle([tag])).toBe(aisle);
  });

  it.each([
    ["en:fruits", "Fruit & veg"],
    ["en:vegetables", "Fruit & veg"],
    ["en:fresh-vegetables", "Fruit & veg"],
    ["en:potatoes", "Fruit & veg"],
  ] as const)("maps %s to %s", (tag, aisle) => {
    expect(mapCategoryTagsToAisle([tag])).toBe(aisle);
  });

  it.each([
    ["en:breads", "Bakery"],
    ["en:bakery-products", "Bakery"],
    ["en:pastries", "Bakery"],
  ] as const)("maps %s to %s", (tag, aisle) => {
    expect(mapCategoryTagsToAisle([tag])).toBe(aisle);
  });

  it("falls back to Cupboard for tagged-but-unmatched categories", () => {
    expect(mapCategoryTagsToAisle(["en:canned-foods", "en:pastas"])).toBe(
      "Cupboard",
    );
  });

  it("falls back to Other for null tags (unknown, not shelf-stable)", () => {
    expect(mapCategoryTagsToAisle(null)).toBe("Other");
  });

  it("falls back to Other for an empty tag array", () => {
    expect(mapCategoryTagsToAisle([])).toBe("Other");
  });

  it("falls back to Other when every tag is blank/whitespace", () => {
    expect(mapCategoryTagsToAisle(["  ", ""])).toBe("Other");
  });

  it("matches case-insensitively and with a locale-prefixed tag", () => {
    expect(mapCategoryTagsToAisle(["EN:MEATS"])).toBe("Meat & fish");
  });

  it("the first matching rule wins over a later, unrelated tag", () => {
    expect(mapCategoryTagsToAisle(["en:frozen-foods", "en:meats"])).toBe(
      "Meat & fish",
    );
  });
});
