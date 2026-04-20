import { describe, it, expect } from "vitest";
import { toStringArray } from "../queryParams";

describe("toStringArray", () => {
  it("returns empty array for undefined", () => {
    expect(toStringArray(undefined)).toEqual([]);
  });

  it("returns empty array for empty string (falsy)", () => {
    // Elysia hands undefined rather than "" for absent params, but the
    // falsy branch should stay defensive.
    expect(toStringArray("")).toEqual([]);
  });

  it("wraps a single string in an array", () => {
    expect(toStringArray("strength")).toEqual(["strength"]);
  });

  it("returns an existing array unchanged", () => {
    expect(toStringArray(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array input as an empty array", () => {
    expect(toStringArray([])).toEqual([]);
  });
});
