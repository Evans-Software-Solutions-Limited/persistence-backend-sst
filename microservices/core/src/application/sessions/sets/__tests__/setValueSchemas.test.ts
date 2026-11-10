import { describe, expect, it } from "vitest";
import {
  DISTANCE_METERS_MAX,
  WEIGHT_KG_MAX,
  storableSetValue,
} from "../setValueSchemas";

describe("storableSetValue", () => {
  it.each([
    [60, "60"],
    ["62.5", "62.5"],
    [" 70 ", "70"],
    [0, "0"],
    [WEIGHT_KG_MAX, "9999.99"],
    ["9999.99", "9999.99"],
    [123.456, "123.46"],
    ["60.555", "60.56"],
    [1e-7, "0"],
  ])("stores %p as a plain decimal", (value, expected) => {
    expect(storableSetValue(value, WEIGHT_KG_MAX)).toBe(expected);
  });

  it.each([
    ["the production 35532 kg set", 35532],
    ["just over the column", 10000],
    ["a string that rounds over the column", "9999.995"],
    ["three decimals that round over", "9999.999"],
    ["negative", -1],
    ["not a number", "heavy"],
    ["empty", ""],
    ["blank", "   "],
    ["infinite", Number.POSITIVE_INFINITY],
    // JS parses these, but the raw text could fail Postgres' numeric input
    // and the whole workout with it (Inspector Brad, PR #532).
    ["exponent text", "1e-1001"],
    ["hex text", "0x10"],
    ["binary text", "0b11"],
    ["signed text", "+5"],
    ["NaN", Number.NaN],
  ])("blanks %s", (_label, value) => {
    expect(storableSetValue(value, WEIGHT_KG_MAX)).toBeNull();
  });

  it("passes null and undefined through as null", () => {
    expect(storableSetValue(null, WEIGHT_KG_MAX)).toBeNull();
    expect(storableSetValue(undefined, WEIGHT_KG_MAX)).toBeNull();
  });

  it("uses the limit it is given (distance)", () => {
    expect(storableSetValue(42195.5, DISTANCE_METERS_MAX)).toBe("42195.5");
    expect(storableSetValue("1000000", DISTANCE_METERS_MAX)).toBeNull();
  });
});
