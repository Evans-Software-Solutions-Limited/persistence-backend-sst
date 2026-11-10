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
    // Postgres rounds these, exactly as it does for a set edit: 1.005 must
    // become 1.01, which rounding the double got wrong (Inspector Brad).
    [123.456, "123.456"],
    ["1.005", "1.005"],
    [1.005, "1.005"],
    ["60.555", "60.555"],
    ["9999.994", "9999.994"],
    ["007.5", "7.5"],
    ["0.5", "0.5"],
    ["1.00499999", "1.004"],
    ["1.0051", "1.005"],
    [".5", ".5"],
    [1e-7, "0"],
  ])(
    "stores %p as a plain decimal Postgres rounds itself",
    (value, expected) => {
      expect(storableSetValue(value, WEIGHT_KG_MAX)).toBe(expected);
    },
  );

  it.each([
    ["the production 35532 kg set", 35532],
    ["just over the column", 10000],
    ["a string that rounds over the column", "9999.995"],
    ["three decimals that round over", "9999.999"],
    ["the number at the rounding edge", 9999.995],
    ["a huge number", 1e30],
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

describe("storableSetValue at the rounding edge", () => {
  it("blanks exactly the values Postgres would round past the column", () => {
    expect(storableSetValue("9999.9949999", WEIGHT_KG_MAX)).toBe("9999.994");
    expect(storableSetValue("9999.995", WEIGHT_KG_MAX)).toBeNull();
    expect(storableSetValue("999999.995", DISTANCE_METERS_MAX)).toBeNull();
    expect(storableSetValue("999999.99", DISTANCE_METERS_MAX)).toBe(
      "999999.99",
    );
  });
});

describe("storableSetValue keeps the text Postgres can read", () => {
  // numeric_in rejects a display scale above 16383, which would fail the
  // whole workout's transaction (Inspector Brad, PR #532).
  it("cuts a very long fraction to the three digits rounding reads", () => {
    expect(storableSetValue(`1.${"0".repeat(16384)}`, WEIGHT_KG_MAX)).toBe(
      "1.000",
    );
    expect(storableSetValue(`60.555${"9".repeat(20000)}`, WEIGHT_KG_MAX)).toBe(
      "60.555",
    );
  });

  it("drops a very long run of leading zeros", () => {
    expect(storableSetValue(`${"0".repeat(20000)}62.5`, WEIGHT_KG_MAX)).toBe(
      "62.5",
    );
    expect(storableSetValue("000", WEIGHT_KG_MAX)).toBe("0");
  });
});
