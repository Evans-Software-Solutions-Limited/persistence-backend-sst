import type {
  AiFoodItem,
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
  computeFuelTargetsPreview,
  computeManualFuelTargetsPreview,
  computeRecipeDraftMacros,
  computeRemaining,
  defaultMealSlot,
  detectDailyGoalHit,
  flattenFuelEntries,
  goalAdjustedKcal,
  goalDelta,
  goalLabel,
  groupBySlot,
  MACRO_PRESETS,
  macroSplitSumsTo100,
  macrosFromKcal,
  manualKcalInRange,
  MANUAL_KCAL_MAX,
  MANUAL_KCAL_MIN,
  presetSplit,
  recomputeFuelToday,
  recommendedSplit,
  rescaleAiFoodItem,
  scaleFoodMacros,
  scaleRecipeMacros,
  setFuelTargets,
  setFuelWater,
  sumKeptAiItemsKcal,
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
  customName: null,
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

describe("presetSplit", () => {
  it("resolves the three fixed presets, ignoring goal", () => {
    expect(presetSplit("high_protein", 0)).toEqual({
      proteinPct: 40,
      carbsPct: 30,
      fatPct: 30,
    });
    expect(presetSplit("balanced", 0)).toEqual({
      proteinPct: 30,
      carbsPct: 40,
      fatPct: 30,
    });
    expect(presetSplit("low_carb", 0)).toEqual({
      proteinPct: 35,
      carbsPct: 20,
      fatPct: 45,
    });
    expect(presetSplit("high_protein", -0.9)).toEqual(
      presetSplit("high_protein", 0.9),
    );
  });

  it("'recommended' tracks the goal slider via recommendedSplit", () => {
    expect(presetSplit("recommended", -0.9)).toEqual(recommendedSplit(-0.9));
    expect(presetSplit("recommended", 0.9)).toEqual(recommendedSplit(0.9));
    expect(presetSplit("recommended", -0.9)).not.toEqual(
      presetSplit("recommended", 0.9),
    );
  });

  it("MACRO_PRESETS carries exactly the three fixed presets, each summing to 100", () => {
    expect(MACRO_PRESETS).toHaveLength(3);
    for (const p of MACRO_PRESETS) {
      expect(p.split.proteinPct + p.split.carbsPct + p.split.fatPct).toBe(100);
    }
  });
});

describe("macroSplitSumsTo100", () => {
  it("is true for a split summing to exactly 100", () => {
    expect(
      macroSplitSumsTo100({ proteinPct: 30, carbsPct: 45, fatPct: 25 }),
    ).toBe(true);
  });

  it("is true for every fixed preset (sanity check)", () => {
    for (const p of MACRO_PRESETS) {
      expect(macroSplitSumsTo100(p.split)).toBe(true);
    }
  });

  it("is false when the three percentages sum to more or less than 100", () => {
    expect(
      macroSplitSumsTo100({ proteinPct: 30, carbsPct: 45, fatPct: 30 }),
    ).toBe(false);
    expect(
      macroSplitSumsTo100({ proteinPct: 20, carbsPct: 30, fatPct: 20 }),
    ).toBe(false);
  });
});

describe("computeFuelTargetsPreview", () => {
  const PROFILE = {
    sex: "male" as const,
    age: 28,
    heightCm: 178,
    weightKg: 79.8,
  };

  it("computes bmr/tdee/kcal/macros end-to-end for a complete profile", () => {
    const preview = computeFuelTargetsPreview(
      PROFILE,
      "moderate",
      0,
      "recommended",
      { proteinPct: 30, carbsPct: 45, fatPct: 25 },
    );
    const expectedBmr = bmrMifflinStJeor(PROFILE);
    const expectedTdee = tdee(expectedBmr, activityMultiplier("moderate"));
    const expectedKcal = goalAdjustedKcal(expectedTdee, 0);
    expect(preview.bmr).toBeCloseTo(expectedBmr!, 5);
    expect(preview.tdee).toBeCloseTo(expectedTdee!, 5);
    expect(preview.kcal).toBe(expectedKcal);
    expect(preview.macroSplit).toEqual(presetSplit("recommended", 0));
    expect(preview.macroGrams).toEqual(
      macrosFromKcal(expectedKcal!, presetSplit("recommended", 0)),
    );
    expect(preview.goalLabel).toEqual(goalLabel(0));
  });

  it("returns null kcal/macroGrams (but a still-valid goalLabel) when the profile is incomplete", () => {
    const preview = computeFuelTargetsPreview(
      { sex: null, age: 28, heightCm: 178, weightKg: 79.8 },
      "moderate",
      0.5,
      "recommended",
      { proteinPct: 30, carbsPct: 45, fatPct: 25 },
    );
    expect(preview.bmr).toBeNull();
    expect(preview.tdee).toBeNull();
    expect(preview.kcal).toBeNull();
    expect(preview.macroGrams).toBeNull();
    // The goal label is a pure function of `goal` alone — still renders even
    // though the profile can't produce a kcal number yet.
    expect(preview.goalLabel).toEqual(goalLabel(0.5));
  });

  it("uses the caller-supplied customSplit only in 'custom' mode", () => {
    const custom = { proteinPct: 50, carbsPct: 30, fatPct: 20 };
    const preview = computeFuelTargetsPreview(
      PROFILE,
      "moderate",
      0,
      "custom",
      custom,
    );
    expect(preview.macroSplit).toEqual(custom);
  });

  it("a fixed preset's split is independent of the goal slider", () => {
    const atCut = computeFuelTargetsPreview(
      PROFILE,
      "moderate",
      -0.9,
      "high_protein",
      { proteinPct: 30, carbsPct: 45, fatPct: 25 },
    );
    const atBulk = computeFuelTargetsPreview(
      PROFILE,
      "moderate",
      0.9,
      "high_protein",
      { proteinPct: 30, carbsPct: 45, fatPct: 25 },
    );
    expect(atCut.macroSplit).toEqual(presetSplit("high_protein", -0.9));
    expect(atBulk.macroSplit).toEqual(presetSplit("high_protein", 0.9));
    expect(atCut.macroSplit).toEqual(atBulk.macroSplit);
  });

  it("'recommended' mode's split DOES track the goal slider (prototype parity)", () => {
    const atCut = computeFuelTargetsPreview(
      PROFILE,
      "moderate",
      -0.9,
      "recommended",
      { proteinPct: 30, carbsPct: 45, fatPct: 25 },
    );
    const atBulk = computeFuelTargetsPreview(
      PROFILE,
      "moderate",
      0.9,
      "recommended",
      { proteinPct: 30, carbsPct: 45, fatPct: 25 },
    );
    expect(atCut.macroSplit).toEqual(recommendedSplit(-0.9));
    expect(atBulk.macroSplit).toEqual(recommendedSplit(0.9));
    expect(atCut.macroSplit).not.toEqual(atBulk.macroSplit);
  });

  it("'custom' mode preserves an invalid (sum ≠ 100) split verbatim — no auto-rebalance", () => {
    // design.md § Risks: independent sliders can produce a split that doesn't
    // sum to 100; the preview must surface it as-is for the warning chip to
    // catch, not silently correct it.
    const invalid = { proteinPct: 50, carbsPct: 50, fatPct: 20 };
    const preview = computeFuelTargetsPreview(
      PROFILE,
      "moderate",
      0,
      "custom",
      invalid,
    );
    expect(preview.macroSplit).toEqual(invalid);
    expect(macroSplitSumsTo100(preview.macroSplit)).toBe(false);
  });
});

describe("computeManualFuelTargetsPreview + manualKcalInRange", () => {
  const SPLIT = { proteinPct: 30, carbsPct: 45, fatPct: 25 };

  it("uses the typed kcal directly — no bmr/tdee — with the preset split applied", () => {
    const preview = computeManualFuelTargetsPreview(
      2200,
      0,
      "recommended",
      SPLIT,
    );
    expect(preview.bmr).toBeNull();
    expect(preview.tdee).toBeNull();
    expect(preview.kcal).toBe(2200);
    expect(preview.macroSplit).toEqual(presetSplit("recommended", 0));
    expect(preview.macroGrams).toEqual(
      macrosFromKcal(2200, presetSplit("recommended", 0)),
    );
  });

  it("uses the caller's customSplit in 'custom' mode (split stays editable)", () => {
    const custom = { proteinPct: 50, carbsPct: 30, fatPct: 20 };
    const preview = computeManualFuelTargetsPreview(2200, 0, "custom", custom);
    expect(preview.macroSplit).toEqual(custom);
    expect(preview.macroGrams).toEqual(macrosFromKcal(2200, custom));
  });

  it("rounds a fractional entry to whole kcal", () => {
    expect(
      computeManualFuelTargetsPreview(2199.6, 0, "balanced", SPLIT).kcal,
    ).toBe(2200);
  });

  it("nulls kcal/macroGrams when the entry is absent or out of range", () => {
    for (const bad of [
      null,
      MANUAL_KCAL_MIN - 1,
      MANUAL_KCAL_MAX + 1,
      0,
      -50,
    ]) {
      const preview = computeManualFuelTargetsPreview(
        bad,
        0,
        "balanced",
        SPLIT,
      );
      expect(preview.kcal).toBeNull();
      expect(preview.macroGrams).toBeNull();
    }
  });

  it("manualKcalInRange accepts the inclusive bounds", () => {
    expect(manualKcalInRange(MANUAL_KCAL_MIN)).toBe(true);
    expect(manualKcalInRange(MANUAL_KCAL_MAX)).toBe(true);
    expect(manualKcalInRange(MANUAL_KCAL_MIN - 0.01)).toBe(false);
    expect(manualKcalInRange(null)).toBe(false);
  });
});

// ── AI estimate item rescaling (Snap / free-text draft card, M9.5) ──────────

const aiItem = (over: Partial<AiFoodItem> = {}): AiFoodItem => ({
  name: "Jasmine rice",
  quantity: 250,
  unit: "g",
  estimatedGrams: 250,
  kcal: 320,
  proteinG: 6,
  carbsG: 70,
  fatG: 1,
  confidence: 0.91,
  ...over,
});

describe("rescaleAiFoodItem", () => {
  it("scales kcal/macros/quantity proportionally to the new grams", () => {
    const next = rescaleAiFoodItem(aiItem(), 125); // half the grams
    expect(next.estimatedGrams).toBe(125);
    expect(next.quantity).toBe(125);
    expect(next.kcal).toBe(160);
    expect(next.proteinG).toBe(3);
    expect(next.carbsG).toBe(35);
    expect(next.fatG).toBe(1); // 0.5 rounds to nearest even/away — Math.round(0.5)=1
  });

  it("scales up proportionally", () => {
    const next = rescaleAiFoodItem(
      aiItem({ estimatedGrams: 100, kcal: 100 }),
      200,
    );
    expect(next.kcal).toBe(200);
    expect(next.estimatedGrams).toBe(200);
  });

  it("leaves the item's macros untouched when grams are unchanged", () => {
    const item = aiItem();
    const next = rescaleAiFoodItem(item, item.estimatedGrams);
    expect(next).toEqual(item);
  });

  it("guards a zero/negative original gram figure (no divide-by-zero blowup)", () => {
    const zeroGramItem = aiItem({ estimatedGrams: 0 });
    const next = rescaleAiFoodItem(zeroGramItem, 150);
    expect(next.estimatedGrams).toBe(150);
    // Macros pass through unchanged — nothing to scale from.
    expect(next.kcal).toBe(zeroGramItem.kcal);
    expect(next.proteinG).toBe(zeroGramItem.proteinG);
  });

  it("clamps a negative new-grams entry to zero", () => {
    const next = rescaleAiFoodItem(aiItem({ estimatedGrams: 0 }), -20);
    expect(next.estimatedGrams).toBe(0);
  });

  it("rescaling to zero grams zeroes out kcal/macros", () => {
    const next = rescaleAiFoodItem(aiItem(), 0);
    expect(next.estimatedGrams).toBe(0);
    expect(next.kcal).toBe(0);
    expect(next.proteinG).toBe(0);
    expect(next.carbsG).toBe(0);
    expect(next.fatG).toBe(0);
  });
});

describe("sumKeptAiItemsKcal", () => {
  it("sums only items with on: true", () => {
    const items = [
      { kcal: 300, on: true },
      { kcal: 320, on: true },
      { kcal: 40, on: false },
    ];
    expect(sumKeptAiItemsKcal(items)).toBe(620);
  });

  it("returns 0 when every item is unticked", () => {
    expect(sumKeptAiItemsKcal([{ kcal: 100, on: false }])).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(sumKeptAiItemsKcal([])).toBe(0);
  });
});

describe("defaultMealSlot", () => {
  const atHour = (hour: number) => {
    const d = new Date(2026, 5, 21, hour, 0, 0);
    return defaultMealSlot(d);
  };

  it("returns breakfast before 11:00", () => {
    expect(atHour(10)).toBe("breakfast");
  });

  it("returns lunch at 11:00 (the breakfast/lunch boundary)", () => {
    expect(atHour(11)).toBe("lunch");
  });

  it("returns lunch at 14:00 (still under the lunch/snack boundary)", () => {
    expect(atHour(14)).toBe("lunch");
  });

  it("returns snack at 15:00 (the lunch/snack boundary)", () => {
    expect(atHour(15)).toBe("snack");
  });

  it("returns snack at 16:00 (still under the snack/dinner boundary)", () => {
    expect(atHour(16)).toBe("snack");
  });

  it("returns dinner at 17:00 (the snack/dinner boundary)", () => {
    expect(atHour(17)).toBe("dinner");
  });

  it("returns dinner at 18:00 (well past the boundary)", () => {
    expect(atHour(18)).toBe("dinner");
  });
});

describe("computeRecipeDraftMacros", () => {
  const foods: Record<string, Food> = {
    f1: food({
      id: "f1",
      kcal: 150,
      proteinG: 5,
      carbsG: 27,
      fatG: 3,
      servingSize: 100,
    }),
  };
  const getFood = (id: string): Food | null => foods[id] ?? null;

  it("sums a single linked row scaled by quantity/servingSize", () => {
    // 200g of a food whose macros are per-100g → doubled.
    expect(
      computeRecipeDraftMacros([{ foodId: "f1", quantity: 200 }], getFood),
    ).toEqual({ kcal: 300, proteinG: 10, carbsG: 54, fatG: 6 });
  });

  it("sums multiple linked rows", () => {
    expect(
      computeRecipeDraftMacros(
        [
          { foodId: "f1", quantity: 100 },
          { foodId: "f1", quantity: 50 },
        ],
        getFood,
      ),
    ).toEqual({ kcal: 225, proteinG: 8, carbsG: 41, fatG: 5 });
  });

  it("contributes 0 for an unlinked row (no foodId)", () => {
    expect(
      computeRecipeDraftMacros([{ foodId: null, quantity: 100 }], getFood),
    ).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it("contributes 0 for a null quantity", () => {
    expect(
      computeRecipeDraftMacros([{ foodId: "f1", quantity: null }], getFood),
    ).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it("contributes 0 for a zero/negative quantity", () => {
    expect(
      computeRecipeDraftMacros([{ foodId: "f1", quantity: 0 }], getFood),
    ).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    expect(
      computeRecipeDraftMacros([{ foodId: "f1", quantity: -5 }], getFood),
    ).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it("contributes 0 when the linked foodId isn't resolvable (cache miss)", () => {
    expect(
      computeRecipeDraftMacros([{ foodId: "missing", quantity: 100 }], getFood),
    ).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it("falls back to a 100g basis when servingSize is 0", () => {
    const zeroSizeFoods: Record<string, Food> = {
      f2: food({
        id: "f2",
        kcal: 200,
        proteinG: 20,
        carbsG: 0,
        fatG: 0,
        servingSize: 0,
      }),
    };
    expect(
      computeRecipeDraftMacros(
        [{ foodId: "f2", quantity: 50 }],
        (id) => zeroSizeFoods[id] ?? null,
      ),
    ).toEqual({ kcal: 100, proteinG: 10, carbsG: 0, fatG: 0 });
  });

  it("returns all-zero for an empty row list", () => {
    expect(computeRecipeDraftMacros([], getFood)).toEqual({
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });
});
