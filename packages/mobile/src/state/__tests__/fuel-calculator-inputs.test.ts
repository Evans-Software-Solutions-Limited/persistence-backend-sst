import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  loadFuelCalculatorInputs,
  macroInputsFromTarget,
  readFuelCalculatorInputs,
  saveFuelCalculatorInputs,
  type FuelCalculatorInputs,
} from "../fuel-calculator-inputs";

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;

const valid: FuelCalculatorInputs = {
  activityId: "very",
  goal: -0.5,
  calorieMode: "manual",
  manualKcalText: "2450",
  macroMode: "custom",
  customSplit: { proteinPct: 45, carbsPct: 25, fatPct: 30 },
};

afterEach(() => {
  getItem.mockReset();
  getItem.mockImplementation(async () => null);
  setItem.mockReset();
  setItem.mockImplementation(async () => undefined);
});

describe("readFuelCalculatorInputs", () => {
  it("accepts a complete record", () => {
    expect(readFuelCalculatorInputs(valid)).toEqual(valid);
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["an unknown activity", { ...valid, activityId: "couch" }],
    ["a non-numeric goal", { ...valid, goal: "0" }],
    ["an out-of-range goal", { ...valid, goal: 3 }],
    ["an unknown calorie mode", { ...valid, calorieMode: "auto" }],
    ["a non-string manual kcal", { ...valid, manualKcalText: 2450 }],
    ["an unknown macro mode", { ...valid, macroMode: "keto" }],
    ["a missing split", { ...valid, customSplit: null }],
    [
      "an out-of-range split",
      { ...valid, customSplit: { proteinPct: 120, carbsPct: 0, fatPct: 0 } },
    ],
  ])("rejects %s", (_label, value) => {
    expect(readFuelCalculatorInputs(value)).toBeUndefined();
  });
});

describe("macroInputsFromTarget", () => {
  const target = {
    dailyKcal: 2000,
    proteinG: 150,
    carbsG: 200,
    fatG: 67,
    preset: "custom",
  };

  it("returns a fixed preset as-is", () => {
    expect(macroInputsFromTarget({ ...target, preset: "balanced" })).toEqual({
      macroMode: "balanced",
    });
  });

  it("back-derives a custom split from grams, summing to 100", () => {
    expect(macroInputsFromTarget(target)).toEqual({
      macroMode: "custom",
      customSplit: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
    });
  });

  it("returns null for no target, an unknown preset, or unreadable grams", () => {
    expect(macroInputsFromTarget(null)).toBeNull();
    expect(macroInputsFromTarget({ ...target, preset: null })).toBeNull();
    expect(macroInputsFromTarget({ ...target, dailyKcal: 0 })).toBeNull();
    expect(
      macroInputsFromTarget({ ...target, proteinG: 400, carbsG: 300 }),
    ).toBeNull();
  });
});

describe("load / save", () => {
  it("round-trips a record per account", async () => {
    await saveFuelCalculatorInputs("user-1", valid);
    expect(setItem).toHaveBeenCalledWith(
      "persistence.fuel.calculator.v1:user-1",
      JSON.stringify(valid),
    );
    getItem.mockImplementation(async (k: string) =>
      k === "persistence.fuel.calculator.v1:user-1"
        ? JSON.stringify(valid)
        : null,
    );
    expect(await loadFuelCalculatorInputs("user-1")).toEqual(valid);
    expect(await loadFuelCalculatorInputs("user-2")).toBeUndefined();
  });

  it("treats a corrupt record or a storage failure as no record", async () => {
    getItem.mockImplementation(async () => "{not json");
    expect(await loadFuelCalculatorInputs("user-1")).toBeUndefined();
    getItem.mockImplementation(async () => {
      throw new Error("io");
    });
    expect(await loadFuelCalculatorInputs("user-1")).toBeUndefined();
  });

  it("swallows a failed write", async () => {
    setItem.mockImplementation(async () => {
      throw new Error("full");
    });
    await expect(
      saveFuelCalculatorInputs("user-1", valid),
    ).resolves.toBeUndefined();
  });
});
