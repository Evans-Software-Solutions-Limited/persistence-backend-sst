import {
  KG_PER_LB,
  kgToLb,
  lbToKg,
  weightInUnit,
  formatWeight,
  volumeInUnit,
  formatVolumeParts,
  formatVolume,
  cmToFeetInches,
  formatHeight,
} from "../units";

describe("weight conversion", () => {
  it("round-trips kg <-> lb through the exact factor", () => {
    expect(lbToKg(1)).toBeCloseTo(KG_PER_LB, 10);
    expect(kgToLb(KG_PER_LB)).toBeCloseTo(1, 10);
    expect(kgToLb(100)).toBeCloseTo(220.462, 3);
  });

  it("weightInUnit passes kg through unchanged (no metric regression)", () => {
    expect(weightInUnit(72.5, "kg")).toBe(72.5);
    expect(weightInUnit(0, "kg")).toBe(0);
    expect(weightInUnit(22.5, "kg")).toBe(22.5);
  });

  it("weightInUnit converts + rounds lb to one decimal", () => {
    expect(weightInUnit(100, "lb")).toBe(220.5);
    expect(weightInUnit(72.5, "lb")).toBe(159.8);
  });
});

describe("formatWeight", () => {
  it("formats metric at the requested precision without conversion", () => {
    expect(formatWeight(72.5, "kg")).toBe("72.5 kg");
    expect(formatWeight(100, "kg", 0)).toBe("100 kg");
  });

  it("converts + labels imperial", () => {
    expect(formatWeight(100, "lb")).toBe("220.5 lb");
    expect(formatWeight(100, "lb", 0)).toBe("220 lb");
  });
});

describe("volume", () => {
  it("volumeInUnit rounds kg through and converts lb", () => {
    expect(volumeInUnit(6240, "kg")).toBe(6240);
    expect(volumeInUnit(6240.4, "kg")).toBe(6240);
    expect(volumeInUnit(1000, "lb")).toBe(2205);
  });

  it("formatVolumeParts shows tonnes for metric >= 1t, kg below, lb for imperial", () => {
    expect(formatVolumeParts(6240, "kg")).toEqual({ value: "6.2", unit: "t" });
    expect(formatVolumeParts(500, "kg")).toEqual({ value: "500", unit: "kg" });
    expect(formatVolumeParts(12000, "kg")).toEqual({
      value: "12.0",
      unit: "t",
    });
    expect(formatVolumeParts(6240, "lb")).toEqual({
      value: "13,757",
      unit: "lb",
    });
  });

  it("thousands-separates the whole-number branches", () => {
    expect(formatVolumeParts(9500, "kg")).toEqual({ value: "9.5", unit: "t" });
    expect(formatVolumeParts(950, "kg").value).toBe("950");
  });

  it("formatVolume joins value + unit", () => {
    expect(formatVolume(6240, "kg")).toBe("6.2 t");
    expect(formatVolume(500, "kg")).toBe("500 kg");
    expect(formatVolume(6240, "lb")).toBe("13,757 lb");
  });
});

describe("height", () => {
  it("splits cm into feet + inches (rounded)", () => {
    expect(cmToFeetInches(178)).toEqual({ feet: 5, inches: 10 });
    expect(cmToFeetInches(180)).toEqual({ feet: 5, inches: 11 });
    expect(cmToFeetInches(152.4)).toEqual({ feet: 5, inches: 0 });
  });

  it("formats height per unit, em dash for null", () => {
    expect(formatHeight(178, "cm")).toBe("178 cm");
    expect(formatHeight(178, "ftin")).toBe("5'10\"");
    expect(formatHeight(null, "cm")).toBe("—");
    expect(formatHeight(undefined, "ftin")).toBe("—");
  });
});
