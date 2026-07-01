import type {
  Food,
  FuelToday,
  NutritionEntry,
  NutritionTarget,
  Recipe,
} from "@/domain/models/nutrition";
import {
  ACTIVITY_LEVELS,
  activityMultiplier,
  bmrMifflinStJeor,
  computeConsumed,
  computeRemaining,
  detectDailyGoalHit,
  flattenFuelEntries,
  goalAdjustedKcal,
  goalDelta,
  goalLabel,
  groupBySlot,
  macrosFromKcal,
  recomputeFuelToday,
  recommendedSplit,
  scaleFoodMacros,
  scaleRecipeMacros,
  setFuelTargets,
  setFuelWater,
  tdee,
  withinBand,
} from "../nutrition.service";

const entry = (over: Partial<NutritionEntry> = {}): NutritionEntry => ({
  id: "e1",
  userId: "u1",
  foodId: null,
  recipeId: null,
  mealId: null,
  mealSlot: "breakfast",
  servings: 1,
  kcal: 100,
  proteinG: 10,
  carbsG: 20,
  fatG: 5,
  loggedAt: "2026-06-21T08:00:00.000Z",
  loggedByUserId: null,
  aiEstimated: false,
  aiConfidence: null,
  ...over,
});

const food = (over: Partial<Food> = {}): Food => ({
  id: "f1",
  name: "Oats",
  brand: null,
  barcode: null,
  kcal: 150,
  proteinG: 5,
  carbsG: 27,
  fatG: 3,
  servingSize: 40,
  servingUnit: "g",
  source: "openfoodfacts",
  createdBy: null,
  ...over,
});

const target = (over: Partial<NutritionTarget> = {}): NutritionTarget => ({
  userId: "u1",
  dailyKcal: 2000,
  proteinG: 150,
  carbsG: 200,
  fatG: 60,
  waterCups: 8,
  preset: "custom",
  setByUserId: null,
  setByName: null,
  updatedAt: null,
  ...over,
});

describe("computeConsumed", () => {
  it("returns all-zero for no entries", () => {
    expect(computeConsumed([])).toEqual({
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it("sums macros across entries", () => {
    expect(
      computeConsumed([entry(), entry({ kcal: 250, proteinG: 30 })]),
    ).toEqual({ kcal: 350, proteinG: 40, carbsG: 40, fatG: 10 });
  });
});

describe("computeRemaining", () => {
  it("is 0 when no target is set", () => {
    expect(computeRemaining(null, { kcal: 500 })).toBe(0);
  });

  it("subtracts consumed kcal from the daily target", () => {
    expect(computeRemaining(target(), { kcal: 500 })).toBe(1500);
  });

  it("can go negative when over the target", () => {
    expect(computeRemaining(target(), { kcal: 2200 })).toBe(-200);
  });
});

describe("groupBySlot", () => {
  it("buckets entries and keeps all four slots present", () => {
    const grouped = groupBySlot([
      entry({ id: "a", mealSlot: "lunch" }),
      entry({ id: "b", mealSlot: "lunch" }),
      entry({ id: "c", mealSlot: "dinner" }),
    ]);
    expect(grouped.breakfast).toEqual([]);
    expect(grouped.snack).toEqual([]);
    expect(grouped.lunch.map((e) => e.id)).toEqual(["a", "b"]);
    expect(grouped.dinner.map((e) => e.id)).toEqual(["c"]);
  });
});

describe("scaleFoodMacros", () => {
  it("scales per-serving macros by servings (rounded)", () => {
    expect(scaleFoodMacros(food(), 2)).toEqual({
      kcal: 300,
      proteinG: 10,
      carbsG: 54,
      fatG: 6,
    });
  });

  it("rounds fractional servings", () => {
    expect(scaleFoodMacros(food({ kcal: 101 }), 0.5).kcal).toBe(51);
  });
});

describe("scaleRecipeMacros", () => {
  const recipe = (over: Partial<Recipe> = {}): Recipe => ({
    id: "r1",
    userId: "u1",
    name: "Chilli",
    photoUrl: null,
    servings: 4,
    instructions: null,
    source: "manual",
    sourceUrl: null,
    totalKcal: 800,
    totalProteinG: 60,
    totalCarbsG: 80,
    totalFatG: 20,
    ingredients: [],
    ...over,
  });

  it("scales recipe totals per logged serving", () => {
    expect(scaleRecipeMacros(recipe(), 1)).toEqual({
      kcal: 200,
      proteinG: 15,
      carbsG: 20,
      fatG: 5,
    });
  });

  it("returns zeros when the recipe yield is 0 (no divide-by-zero)", () => {
    expect(scaleRecipeMacros(recipe({ servings: 0 }), 2)).toEqual({
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it("treats null totals as 0", () => {
    expect(
      scaleRecipeMacros(recipe({ totalKcal: null, totalProteinG: null }), 2)
        .kcal,
    ).toBe(0);
  });
});

describe("bmrMifflinStJeor", () => {
  it("computes male BMR (+5)", () => {
    expect(
      bmrMifflinStJeor({ sex: "male", age: 28, heightCm: 178, weightKg: 79.8 }),
    ).toBeCloseTo(10 * 79.8 + 6.25 * 178 - 5 * 28 + 5, 5);
  });

  it("computes female BMR (-161)", () => {
    expect(
      bmrMifflinStJeor({ sex: "female", age: 30, heightCm: 165, weightKg: 60 }),
    ).toBeCloseTo(10 * 60 + 6.25 * 165 - 5 * 30 - 161, 5);
  });

  it("computes 'other' BMR at the midpoint constant (-78)", () => {
    expect(
      bmrMifflinStJeor({ sex: "other", age: 30, heightCm: 170, weightKg: 70 }),
    ).toBeCloseTo(10 * 70 + 6.25 * 170 - 5 * 30 - 78, 5);
  });

  it("places 'other' exactly between male and female for identical stats", () => {
    const base = { age: 30, heightCm: 170, weightKg: 70 };
    const male = bmrMifflinStJeor({ ...base, sex: "male" })!;
    const female = bmrMifflinStJeor({ ...base, sex: "female" })!;
    const other = bmrMifflinStJeor({ ...base, sex: "other" })!;
    expect(other).toBeCloseTo((male + female) / 2, 5);
  });

  it.each([
    { sex: null, age: 30, heightCm: 170, weightKg: 70 },
    { sex: "male" as const, age: null, heightCm: 170, weightKg: 70 },
    { sex: "male" as const, age: 30, heightCm: null, weightKg: 70 },
    { sex: "male" as const, age: 30, heightCm: 170, weightKg: null },
    { sex: "male" as const, age: NaN, heightCm: 170, weightKg: 70 },
  ])("returns null when a required field is missing/invalid (%#)", (p) => {
    expect(bmrMifflinStJeor(p)).toBeNull();
  });
});

describe("activityMultiplier / ACTIVITY_LEVELS", () => {
  it("maps known ids to their multiplier", () => {
    expect(activityMultiplier("sedentary")).toBe(1.2);
    expect(activityMultiplier("athlete")).toBe(1.9);
  });

  it("exposes five levels", () => {
    expect(ACTIVITY_LEVELS).toHaveLength(5);
  });
});

describe("tdee", () => {
  it("multiplies BMR by the activity multiplier", () => {
    expect(tdee(1600, 1.55)).toBeCloseTo(2480, 5);
  });
  it("propagates null", () => {
    expect(tdee(null, 1.55)).toBeNull();
  });
});

describe("goalDelta", () => {
  it("scales surplus at 0.20", () => {
    expect(goalDelta(1)).toBeCloseTo(0.2, 5);
    expect(goalDelta(0)).toBe(0);
  });
  it("scales deficit at 0.25", () => {
    expect(goalDelta(-1)).toBeCloseTo(-0.25, 5);
  });
});

describe("goalAdjustedKcal", () => {
  it("rounds to the nearest 10", () => {
    // tdee 2480, maintain → 2480 → round/10*10 = 2480
    expect(goalAdjustedKcal(2480, 0)).toBe(2480);
    // bulk +20% → 2976 → 2980
    expect(goalAdjustedKcal(2480, 1)).toBe(2980);
    // cut -25% → 1860 → 1860
    expect(goalAdjustedKcal(2480, -1)).toBe(1860);
  });
  it("propagates null", () => {
    expect(goalAdjustedKcal(null, 0)).toBeNull();
  });
});

describe("recommendedSplit", () => {
  it.each([
    [-1, { proteinPct: 40, carbsPct: 35, fatPct: 25 }],
    [-0.25, { proteinPct: 35, carbsPct: 40, fatPct: 25 }],
    [0.25, { proteinPct: 30, carbsPct: 45, fatPct: 25 }],
    [1, { proteinPct: 25, carbsPct: 50, fatPct: 25 }],
  ])("split for goal %s", (goal, expected) => {
    expect(recommendedSplit(goal)).toEqual(expected);
  });
});

describe("macrosFromKcal", () => {
  it("converts kcal + split to grams (4/4/9)", () => {
    expect(
      macrosFromKcal(2000, { proteinPct: 30, carbsPct: 40, fatPct: 30 }),
    ).toEqual({
      proteinG: Math.round((2000 * 0.3) / 4),
      carbsG: Math.round((2000 * 0.4) / 4),
      fatG: Math.round((2000 * 0.3) / 9),
    });
  });
});

describe("goalLabel", () => {
  it.each([
    [-1, "Aggressive cut", "ember"],
    [-0.5, "Cut", "primary"],
    [0, "Maintain", "success"],
    [0.5, "Lean bulk", "gold"],
    [1, "Aggressive bulk", "gold"],
  ])("labels goal %s", (goal, name, tone) => {
    const l = goalLabel(goal);
    expect(l.name).toBe(name);
    expect(l.tone).toBe(tone);
  });
});

describe("withinBand", () => {
  it("is false for a non-positive target", () => {
    expect(withinBand(0, 0)).toBe(false);
  });
  it("is true exactly on target and at both edges", () => {
    expect(withinBand(2000, 2000)).toBe(true);
    expect(withinBand(1800, 2000)).toBe(true); // -10%
    expect(withinBand(2200, 2000)).toBe(true); // +10%
  });
  it("is false just outside the band", () => {
    expect(withinBand(1799, 2000)).toBe(false);
    expect(withinBand(2201, 2000)).toBe(false);
  });
});

describe("detectDailyGoalHit", () => {
  it("is all-false with no target", () => {
    expect(
      detectDailyGoalHit(
        { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
        null,
      ),
    ).toEqual({
      kcal: false,
      protein: false,
      carbs: false,
      fat: false,
      all: false,
    });
  });

  it("flags `all` when every metric is in band", () => {
    expect(
      detectDailyGoalHit(
        { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
        target(),
      ),
    ).toEqual({ kcal: true, protein: true, carbs: true, fat: true, all: true });
  });

  it("flags kcal-only when macros are out of band", () => {
    const hit = detectDailyGoalHit(
      { kcal: 2000, proteinG: 10, carbsG: 10, fatG: 10 },
      target(),
    );
    expect(hit.kcal).toBe(true);
    expect(hit.all).toBe(false);
    expect(hit.protein).toBe(false);
  });
});

const fuel = (over: Partial<FuelToday> = {}): FuelToday => ({
  date: "2026-06-21",
  targets: target(),
  consumed: { kcal: 100, proteinG: 10, carbsG: 20, fatG: 5, waterCups: 3 },
  remainingKcal: 1900,
  entriesBySlot: {
    breakfast: [entry()],
    lunch: [],
    snack: [],
    dinner: [],
  },
  ...over,
});

describe("flattenFuelEntries", () => {
  it("concatenates all four slots in order", () => {
    const f = fuel({
      entriesBySlot: {
        breakfast: [entry({ id: "b" })],
        lunch: [entry({ id: "l" })],
        snack: [entry({ id: "s" })],
        dinner: [entry({ id: "d" })],
      },
    });
    expect(flattenFuelEntries(f).map((e) => e.id)).toEqual([
      "b",
      "l",
      "s",
      "d",
    ]);
  });
});

describe("recomputeFuelToday", () => {
  it("recomputes consumed + remaining + slots, preserving date/targets/water", () => {
    const next = recomputeFuelToday(fuel(), [
      entry({
        id: "x",
        kcal: 500,
        proteinG: 40,
        carbsG: 50,
        fatG: 10,
        mealSlot: "lunch",
      }),
    ]);
    expect(next.date).toBe("2026-06-21");
    expect(next.consumed).toEqual({
      kcal: 500,
      proteinG: 40,
      carbsG: 50,
      fatG: 10,
      waterCups: 3, // preserved
    });
    expect(next.remainingKcal).toBe(1500); // 2000 - 500
    expect(next.entriesBySlot.lunch).toHaveLength(1);
    expect(next.entriesBySlot.breakfast).toHaveLength(0);
  });

  it("remaining is 0 when no target", () => {
    const next = recomputeFuelToday(fuel({ targets: null }), [
      entry({ kcal: 300 }),
    ]);
    expect(next.remainingKcal).toBe(0);
  });
});

describe("setFuelWater", () => {
  it("sets absolute cups (clamped, truncated) without touching macros", () => {
    const next = setFuelWater(fuel(), 6.9);
    expect(next.consumed.waterCups).toBe(6);
    expect(next.consumed.kcal).toBe(100);
  });
  it("clamps negative to 0", () => {
    expect(setFuelWater(fuel(), -3).consumed.waterCups).toBe(0);
  });
});

describe("setFuelTargets", () => {
  it("swaps targets and recomputes remaining off current consumed", () => {
    const next = setFuelTargets(fuel(), target({ dailyKcal: 1500 }));
    expect(next.targets?.dailyKcal).toBe(1500);
    expect(next.remainingKcal).toBe(1400); // 1500 - 100 consumed
  });
});
