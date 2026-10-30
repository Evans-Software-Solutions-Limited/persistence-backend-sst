import { per100Macros } from "@/domain/services/nutrition.service";

describe("per100Macros (PER-95)", () => {
  const base = {
    kcal: 69.5,
    proteinG: 14.4,
    carbsG: 0.4,
    fatG: 1.05,
    servingSize: 50,
    servingUnit: "g",
  };

  it("rescales a gram-based food to its per-100 g reference", () => {
    const per100 = per100Macros(base);
    expect(per100?.kcal).toBeCloseTo(139, 5);
    expect(per100?.proteinG).toBeCloseTo(28.8, 5);
    expect(per100?.carbsG).toBeCloseTo(0.8, 5);
    expect(per100?.fatG).toBeCloseTo(2.1, 5);
  });

  it("accepts a millilitre basis, case-insensitively", () => {
    expect(
      per100Macros({ ...base, servingSize: 100, servingUnit: " ML " })?.kcal,
    ).toBeCloseTo(69.5, 5);
  });

  it("returns null for a count basis or a missing size", () => {
    expect(per100Macros({ ...base, servingUnit: "slice" })).toBeNull();
    expect(per100Macros({ ...base, servingSize: 0 })).toBeNull();
  });
});
