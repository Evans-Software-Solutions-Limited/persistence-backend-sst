import type {
  MealprintPreferences,
  PlanDraft,
  PlanGeneratedMeal,
} from "@/domain/models/mealprint";
import type { NutritionEntry } from "@/domain/models/nutrition";
import type { UserMeal } from "@/domain/models/userMeals";
import {
  applyPlanPortions,
  canScalePlanMeal,
  joinNames,
  kcalDeltaLabel,
  mealItemsLine,
  mealsForGenerate,
  notWantedFrom,
  planLogAll,
  preferencesLine,
  resolveLoggedEntryIds,
  scalePlanMeal,
  swapSteer,
  userMealForGeneratedMeal,
  userMealNames,
} from "../mealprintDay.service";

const um = (
  id: string,
  name: string,
  logSlot: UserMeal["logSlot"],
  sortOrder: number,
  defaultKey: UserMeal["defaultKey"] = null,
  archivedAt: string | null = null,
): UserMeal => ({
  id,
  name,
  logSlot,
  sortOrder,
  defaultKey,
  clientRequestId: null,
  archivedAt,
  updatedAt: "2026-11-20T00:00:00.000Z",
});

const MEALS: UserMeal[] = [
  um("um-b", "Breakfast", "breakfast", 0, "breakfast"),
  um("um-pre", "Pre-workout", "snack", 1),
  um("um-l", "Lunch", "lunch", 2, "lunch"),
  um("um-d", "Dinner", "dinner", 3, "dinner"),
  um("um-s", "Snacks", "snack", 4, "snack"),
];

function meal(over: Partial<PlanGeneratedMeal> = {}): PlanGeneratedMeal {
  return {
    name: "Protein oats",
    reason: "fits",
    logSlot: "breakfast",
    items: [
      {
        candidateId: "food-oats",
        kind: "food",
        servings: 1,
        name: "Oats",
        kcal: 300,
        proteinG: 10,
        carbsG: 50,
        fatG: 6,
      },
      {
        candidateId: "recipe-1",
        kind: "recipe",
        servings: 0.5,
        name: "Berry compote",
        kcal: 100,
        proteinG: 1,
        carbsG: 20,
        fatG: 0,
      },
    ],
    kcal: 350,
    proteinG: 10.5,
    carbsG: 60,
    fatG: 6,
    containsUnverified: false,
    flaggedUnsafe: false,
    ...over,
  };
}

const draftOf = (...meals: [string, PlanGeneratedMeal][]): PlanDraft => ({
  planDate: "2026-11-26",
  target: { kcal: 2500, proteinG: 180, carbsG: 300, fatG: 60 },
  mealsPerDay: meals.length,
  meals: meals.map(([localId, m]) => ({ localId, meal: m })),
});

const entry = (
  id: string,
  over: Partial<NutritionEntry> = {},
): NutritionEntry => ({
  id,
  userId: "u1",
  foodId: "food-x",
  recipeId: null,
  mealId: null,
  mealSlot: "breakfast",
  servings: 1,
  kcal: 100,
  proteinG: 1,
  carbsG: 1,
  fatG: 1,
  loggedAt: "2026-11-26T12:00:00.000Z",
  loggedByUserId: null,
  aiEstimated: false,
  aiConfidence: null,
  customName: null,
  userMealId: null,
  ...over,
});

describe("portions (N19)", () => {
  it("scales every item and recomputes the totals", () => {
    const scaled = scalePlanMeal(meal(), 1.5);
    expect(scaled.items.map((i) => i.servings)).toEqual([1.5, 0.75]);
    expect(scaled.kcal).toBe(525);
    expect(scalePlanMeal(meal(), 1)).toEqual(meal());
  });

  it("stops where an item would leave the server's 0.25–2 band", () => {
    expect(canScalePlanMeal(meal(), 2)).toBe(true);
    expect(canScalePlanMeal(meal(), 0.25)).toBe(false); // 0.5 × 0.25 = 0.125
    expect(canScalePlanMeal(meal(), 0.5)).toBe(true);
    expect(canScalePlanMeal(meal(), 2.25)).toBe(false);
    expect(
      canScalePlanMeal(
        meal({ items: [{ ...meal().items[0]!, servings: 1.5 }] }),
        1.5,
      ),
    ).toBe(false);
  });

  it("applies portions to the draft by localId only", () => {
    const d = draftOf(["a", meal()], ["b", meal()]);
    const out = applyPlanPortions(d, { a: 2 });
    expect(out.meals[0]!.meal.kcal).toBe(700);
    expect(out.meals[1]!.meal).toBe(d.meals[1]!.meal);
  });
});

describe("Your meals in generation", () => {
  it("sends the first six active meals in order", () => {
    const many = [
      ...MEALS,
      um("um-x", "Late snack", "snack", 5),
      um("um-y", "Supper", "dinner", 6),
      um("um-gone", "Old", "snack", 7, null, "2026-11-01T00:00:00Z"),
    ];
    expect(mealsForGenerate(many)).toEqual([
      { name: "Breakfast", logSlot: "breakfast" },
      { name: "Pre-workout", logSlot: "snack" },
      { name: "Lunch", logSlot: "lunch" },
      { name: "Dinner", logSlot: "dinner" },
      { name: "Snacks", logSlot: "snack" },
      { name: "Late snack", logSlot: "snack" },
    ]);
  });

  it("falls back (null) with fewer than two meals", () => {
    expect(mealsForGenerate([MEALS[0]!])).toBeNull();
    expect(mealsForGenerate([])).toBeNull();
  });

  it("lists the meal names for the N15 row", () => {
    expect(userMealNames(MEALS)).toBe(
      "Breakfast, Pre-workout, Lunch, Dinner, Snacks",
    );
  });
});

describe("swap panel (N20)", () => {
  it("joins ticked chips and typed feedback into steer, max 200", () => {
    expect(swapSteer([], "  ")).toBeUndefined();
    expect(swapSteer(["High protein"], " no rice ")).toBe(
      "High protein, no rice",
    );
    expect(swapSteer([], "x".repeat(300))).toHaveLength(200);
  });

  it("turns shown meals into notWantedMeals", () => {
    expect(notWantedFrom([meal()])).toEqual([
      { name: "Protein oats", ingredients: ["Oats", "Berry compote"] },
    ]);
  });

  it("labels the kcal difference", () => {
    expect(kcalDeltaLabel(12.4)).toBe("+12 kcal");
    expect(kcalDeltaLabel(-40)).toBe("−40 kcal");
    expect(kcalDeltaLabel(0)).toBe("±0 kcal");
  });

  it("writes a meal's items on one line", () => {
    expect(mealItemsLine(meal())).toBe("Oats · Berry compote ×0.5");
  });
});

describe("Log all today (N22)", () => {
  it("finds the meal by label, else the slot's default", () => {
    expect(
      userMealForGeneratedMeal(
        meal({ label: "pre-workout", logSlot: "snack" }),
        MEALS,
      )?.id,
    ).toBe("um-pre");
    expect(
      userMealForGeneratedMeal(meal({ logSlot: "snack" }), MEALS)?.id,
    ).toBe("um-s");
    expect(userMealForGeneratedMeal(meal({ logSlot: "lunch" }), [])).toBeNull();
  });

  it("logs each meal into its meal and skips meals that already have food", () => {
    const d = draftOf(
      ["a", meal({ label: "Breakfast" })],
      ["b", meal({ name: "Bowl", label: "Lunch", logSlot: "lunch" })],
    );
    const plan = planLogAll(
      d,
      MEALS,
      [entry("e1", { userMealId: "um-b" })],
      "2026-11-26T12:00:00.000Z",
    );
    expect(plan.rows).toEqual([
      {
        localId: "a",
        mealName: "Breakfast",
        dish: "Protein oats",
        kcal: 350,
        skipped: true,
      },
      { localId: "b", mealName: "Lunch", dish: "Bowl", kcal: 350, skipped: false },
    ]);
    expect(plan.inputs).toEqual([
      {
        foodId: "food-oats",
        mealSlot: "lunch",
        userMealId: "um-l",
        servings: 1,
        kcal: 300,
        proteinG: 10,
        carbsG: 50,
        fatG: 6,
        customName: "Oats",
        loggedAt: "2026-11-26T12:00:00.000Z",
      },
      {
        recipeId: "recipe-1",
        mealSlot: "lunch",
        userMealId: "um-l",
        servings: 0.5,
        kcal: 50,
        proteinG: 0.5,
        carbsG: 10,
        fatG: 0,
        customName: "Berry compote",
        loggedAt: "2026-11-26T12:00:00.000Z",
      },
    ]);
  });

  it("logs saved-meal items by mealId, and slot-only without a meal", () => {
    const d = draftOf([
      "a",
      meal({
        label: "Brunch",
        logSlot: "dinner",
        items: [{ ...meal().items[0]!, kind: "meal", candidateId: "meal-9" }],
      }),
    ]);
    const plan = planLogAll(d, [], [], "t");
    expect(plan.rows[0]!.mealName).toBe("Brunch");
    expect(plan.inputs[0]).toMatchObject({ mealId: "meal-9", mealSlot: "dinner" });
    expect(plan.inputs[0]!.userMealId).toBeUndefined();
  });

  it("joins names in plain English", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Breakfast"])).toBe("Breakfast");
    expect(joinNames(["Breakfast", "Snacks"])).toBe("Breakfast and Snacks");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("Undo (N22)", () => {
  it("finds entries by id, or by content after they took the server id", () => {
    const logged = [
      entry("local-1", { foodId: "f1" }),
      entry("local-2", { foodId: "f2" }),
      entry("local-3", { foodId: "f3" }),
    ];
    const current = [
      entry("old", { foodId: "f1" }), // was there before: never touched
      entry("local-1", { foodId: "f1" }),
      entry("srv-2", { foodId: "f2" }), // synced: server id
    ];
    expect(resolveLoggedEntryIds(new Set(["old"]), logged, current)).toEqual([
      "local-1",
      "srv-2",
    ]);
  });
});

describe("preferences line (N15)", () => {
  const prefs = (over: Partial<MealprintPreferences>): MealprintPreferences =>
    ({
      dietaryPatterns: [],
      avoidAllergens: [],
      avoidFoods: [],
      likedFoods: [],
      mealsPerDay: 4,
      effortLevel: "balanced",
      isDefault: false,
      ...over,
    }) as MealprintPreferences;

  it("names the diet, then counts allergens and dislikes", () => {
    expect(
      preferencesLine(
        prefs({
          dietaryPatterns: ["vegetarian"],
          avoidAllergens: ["peanuts", "sesame"],
          avoidFoods: ["mushrooms", "olives", "blue cheese"],
        }),
      ),
    ).toBe("Vegetarian · 2 allergens avoided · 3 disliked");
    expect(preferencesLine(prefs({ avoidAllergens: ["milk"] }))).toBe(
      "1 allergen avoided",
    );
  });

  it("is null with nothing set", () => {
    expect(preferencesLine(null)).toBeNull();
    expect(preferencesLine(prefs({}))).toBeNull();
  });
});
