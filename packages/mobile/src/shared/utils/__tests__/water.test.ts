import {
  ML_PER_CUP,
  LITRES_PER_CUP,
  cupsToLitres,
  litresToCups,
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
