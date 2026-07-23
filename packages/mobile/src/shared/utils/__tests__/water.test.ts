import {
  ML_PER_CUP,
  LITRES_PER_CUP,
  cupsToLitres,
  litresToCups,
  formatLitres,
  preferredVolumeUnit,
} from "../water";

describe("water unit conversion", () => {
  it("defines 1 cup = 250 ml = 0.25 L", () => {
    expect(ML_PER_CUP).toBe(250);
    expect(LITRES_PER_CUP).toBe(0.25);
  });

  it("converts cups → litres (8 cups = 2.0 L)", () => {
    expect(cupsToLitres(8)).toBe(2);
    expect(cupsToLitres(0)).toBe(0);
    expect(cupsToLitres(6)).toBe(1.5);
    expect(cupsToLitres(5)).toBe(1.25);
    expect(cupsToLitres(1)).toBe(0.25); // one 0.25 L step
  });

  it("converts litres → whole cups (rounding a 0.25 L step to ±1 cup)", () => {
    expect(litresToCups(2)).toBe(8);
    expect(litresToCups(1.5)).toBe(6);
    expect(litresToCups(0.25)).toBe(1);
    expect(litresToCups(0)).toBe(0);
  });

  it("round-trips litres derived from float arithmetic to a whole cup", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754; still resolves to 1 cup.
    expect(litresToCups(0.1 + 0.2)).toBe(1);
  });

  it("is a lossless round-trip cups → litres → cups", () => {
    for (let c = 0; c <= 20; c += 1) {
      expect(litresToCups(cupsToLitres(c))).toBe(c);
    }
  });
});

describe("formatLitres", () => {
  it("shows 1 dp for a clean 0.5 L mark", () => {
    expect(formatLitres(2)).toBe("2.0");
    expect(formatLitres(1.5)).toBe("1.5");
  });

  it("shows 2 dp when the value lands off a 0.5 L mark", () => {
    expect(formatLitres(1.25)).toBe("1.25");
  });
});

describe("preferredVolumeUnit (device-QA #5/#7)", () => {
  it("defaults to litres for metric", () => {
    expect(preferredVolumeUnit("metric")).toBe("l");
  });

  it("defaults to litres when unset/unknown (owner's locked default)", () => {
    expect(preferredVolumeUnit(undefined)).toBe("l");
    expect(preferredVolumeUnit(null)).toBe("l");
  });

  it("shows cups for imperial", () => {
    expect(preferredVolumeUnit("imperial")).toBe("cups");
  });
});
