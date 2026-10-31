import { foodOwnServing } from "@/domain/services/nutrition.service";

describe("foodOwnServing (PER-100)", () => {
  it("uses the Open Food Facts pack serving when known", () => {
    expect(
      foodOwnServing({
        servingSize: 100,
        servingUnit: "g",
        servingQuantity: 174,
      }),
    ).toEqual({
      multiplier: 1.74,
      label: "1 serving (174 g)",
      per100: false,
    });
  });

  it("falls back to per 100 g only when the food has no serving of its own", () => {
    expect(
      foodOwnServing({
        servingSize: 100,
        servingUnit: "g",
        servingQuantity: null,
      }),
    ).toEqual({ multiplier: 1, label: "per 100 g", per100: true });
    expect(
      foodOwnServing({ servingSize: 0, servingUnit: "g", servingQuantity: 0 }),
    ).toEqual({ multiplier: 1, label: "per 100 g", per100: true });
    expect(
      foodOwnServing({
        servingSize: 100,
        servingUnit: "ML",
        servingQuantity: null,
      }).label,
    ).toBe("per 100 ml");
  });

  it("keeps a custom food's own gram serving", () => {
    expect(
      foodOwnServing({
        servingSize: 40,
        servingUnit: "g",
        servingQuantity: null,
      }),
    ).toEqual({ multiplier: 1, label: "1 serving (40 g)", per100: false });
  });

  it("names a count serving and ignores a gram pack size against it", () => {
    expect(
      foodOwnServing({
        servingSize: 1,
        servingUnit: "slice",
        servingQuantity: 30,
      }),
    ).toEqual({ multiplier: 1, label: "1 slice", per100: false });
  });

  it("rescales a pack serving against a non-100 g basis", () => {
    expect(
      foodOwnServing({ servingSize: 50, servingUnit: "g", servingQuantity: 75 })
        .multiplier,
    ).toBe(1.5);
  });
});
