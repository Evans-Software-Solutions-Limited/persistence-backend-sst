import type {
  Food,
  FuelToday,
  Meal,
  NutritionEntry,
  NutritionTarget,
  Recipe,
} from "@/domain/models/nutrition";
import type {
  NutritionPlan,
  NutritionPlansCache,
  PlanFromCoach,
} from "@/domain/models/nutritionPlans";
import {
  emptyPlansCache,
  PLAN_ITEMS_PER_MEAL_MAX,
  PLAN_MEALS_MAX,
} from "@/domain/models/nutritionPlans";
import type { UserMeal } from "@/domain/models/userMeals";
import {
  addItemToMeal,
  clampServings,
  cleanPlanName,
  compareWithTarget,
  copyPlanMeals,
  defaultPlanId,
  emptyPlanMeal,
  findPlan,
  firstEmptyMeal,
  isPlanInShoppingList,
  isPlanMealFull,
  planMealFullText,
  logInputsForPlan,
  logInputsForPlanMeal,
  macrosVsTarget,
  mergePlansResponse,
  newCoachPlans,
  newDraftPlan,
  overlayLocalPlans,
  perServingOf,
  planItemCustom,
  planItemFromFood,
  planItemFromRecipe,
  planItemFromSavedMeal,
  planMealsFromDay,
  recomputePlan,
  removeItem,
  replaceItem,
  shoppingProgress,
  userMealForPlanMeal,
  withPlanMeals,
  withServings,
} from "../nutritionPlans.service";

const target: NutritionTarget = {
  userId: "u1",
  dailyKcal: 2371,
  proteinG: 178,
  carbsG: 240,
  fatG: 77,
  waterCups: 8,
  preset: null,
  setByUserId: null,
  setByName: null,
  updatedAt: null,
};

const food: Food = {
  id: "food-1",
  name: "Large egg",
  brand: null,
  barcode: null,
  kcal: 72,
  proteinG: 6.3,
  carbsG: 0.4,
  fatG: 4.8,
  servingSize: 50,
  servingUnit: "g",
  servingQuantity: null,
  source: "openfoodfacts",
  createdBy: null,
} as Food;

const recipe: Recipe = {
  id: "rec-1",
  userId: "u1",
  name: "Turkey chilli",
  photoUrl: null,
  servings: 4,
  instructions: null,
  source: "manual",
  sourceUrl: null,
  totalKcal: 1680,
  totalProteinG: 140,
  totalCarbsG: 160,
  totalFatG: 44,
  ingredients: [],
} as unknown as Recipe;

const savedMeal: Meal = {
  id: "meal-1",
  userId: "u1",
  name: "Bagel breakfast",
  photoUrl: null,
  totalKcal: 526,
  totalProteinG: 34,
  totalCarbsG: 48,
  totalFatG: 21,
  items: [],
};

const um = (id: string, name: string, slot: UserMeal["logSlot"], i: number) =>
  ({
    id,
    name,
    logSlot: slot,
    sortOrder: i,
    defaultKey: ["Breakfast", "Lunch", "Snack", "Dinner"].includes(name)
      ? slot
      : null,
    clientRequestId: null,
    archivedAt: null,
    updatedAt: "t",
  }) as UserMeal;

const userMeals: UserMeal[] = [
  um("um-b", "Breakfast", "breakfast", 0),
  um("um-pre", "Pre-workout", "snack", 1),
  um("um-l", "Lunch", "lunch", 2),
  um("um-s", "Snack", "snack", 3),
  um("um-d", "Dinner", "dinner", 4),
];

let seq = 0;
const newId = () => `local-n${++seq}`;

function draft(): NutritionPlan {
  return newDraftPlan({
    id: "local-p",
    ownerId: "u1",
    name: "Rest day",
    now: "t",
    meals: [
      emptyPlanMeal("m1", "Breakfast", "breakfast", 0),
      emptyPlanMeal("m2", "Lunch", "lunch", 1),
    ],
  });
}

const coach = (
  plan: NutritionPlan,
  status: PlanFromCoach["status"],
): PlanFromCoach => ({
  plan,
  coach: { id: "c", name: "Ellie", avatarUrl: null },
  assignmentId: `a-${plan.id}`,
  note: null,
  status,
  sentAt: "t",
  addedAt: null,
  updatedSinceSeen: false,
});

beforeEach(() => {
  seq = 0;
});

describe("Target · Planned · To plan", () => {
  it("compares with the person's own target", () => {
    expect(
      compareWithTarget(
        { kcal: 1978, proteinG: 0, carbsG: 0, fatG: 0 },
        target,
      ),
    ).toEqual({
      targetKcal: 2371,
      plannedKcal: 1978,
      toPlanKcal: 393,
      state: "to_plan",
    });
    expect(
      compareWithTarget({ kcal: 2300, proteinG: 0, carbsG: 0, fatG: 0 }, target)
        .state,
    ).toBe("on_target");
    expect(
      compareWithTarget(
        { kcal: 2600, proteinG: 0, carbsG: 0, fatG: 0 },
        target,
      ),
    ).toMatchObject({ toPlanKcal: -229, state: "over" });
  });

  it("without a target there is nothing to compare with", () => {
    const planned = { kcal: 500.4, proteinG: 0, carbsG: 0, fatG: 0 };
    expect(compareWithTarget(planned, null)).toEqual({
      targetKcal: null,
      plannedKcal: 500,
      toPlanKcal: null,
      state: "no_target",
    });
    expect(compareWithTarget(planned, { ...target, dailyKcal: 0 }).state).toBe(
      "no_target",
    );
  });

  it("lists P / C / F planned against target", () => {
    const m = macrosVsTarget(
      { kcal: 0, proteinG: 99.6, carbsG: 10, fatG: 5 },
      target,
    );
    expect(m.map((x) => [x.letter, x.plannedG, x.targetG])).toEqual([
      ["P", 100, 178],
      ["C", 10, 240],
      ["F", 5, 77],
    ]);
    expect(
      macrosVsTarget(m as never, null).every((x) => x.targetG === null),
    ).toBe(true);
  });
});

describe("items", () => {
  it("builds items from a food, a recipe portion, a saved meal and a one-off", () => {
    const f = planItemFromFood("i1", food, 2);
    expect(f).toMatchObject({
      kind: "food",
      foodId: "food-1",
      kcal: 144,
      proteinG: 12.6,
    });
    expect(f.logEntry).toEqual({ foodId: "food-1", servings: 2 });
    const r = planItemFromRecipe("i2", recipe, 1);
    expect(r).toMatchObject({ kind: "recipe", kcal: 420, proteinG: 35 });
    expect(
      planItemFromRecipe("i2", { ...recipe, servings: 0, totalKcal: null }, 1)
        .kcal,
    ).toBe(0);
    const m = planItemFromSavedMeal("i3", savedMeal, 1);
    expect(m).toMatchObject({ kind: "meal", mealId: "meal-1", kcal: 526 });
    const c = planItemCustom("i4", "Protein bar", {
      kcal: 198.4,
      proteinG: 20,
      carbsG: 20,
      fatG: 7,
    });
    expect(c.logEntry).toEqual({
      customName: "Protein bar",
      servings: 1,
      kcal: 198,
      proteinG: 20,
      carbsG: 20,
      fatG: 7,
    });
  });

  it("a food, recipe or saved meal still only on the phone goes in as a one-off (Inspector Brad #554)", () => {
    // A plan can't keep up with a local id once it syncs, so the item keeps
    // its name and macros instead of a reference.
    const r = planItemFromRecipe("i", { ...recipe, id: "local-r" }, 2);
    expect(r).toMatchObject({
      kind: "custom",
      recipeId: null,
      name: "Turkey chilli",
      kcal: 840,
      servings: 2,
    });
    expect(r.logEntry).toMatchObject({
      customName: "Turkey chilli",
      kcal: 840,
    });
    expect(
      planItemFromSavedMeal("i", { ...savedMeal, id: "local-m" }, 1),
    ).toMatchObject({ kind: "custom", mealId: null });
    expect(planItemFromFood("i", { ...food, id: "local-f" }, 1)).toMatchObject({
      kind: "custom",
      foodId: null,
    });
  });

  it("changes an amount from the per-serving macros; log hints follow", () => {
    const f = withServings(planItemFromFood("i1", food, 1), 1.5);
    expect(f).toMatchObject({ servings: 1.5, kcal: 108 });
    expect(f.logEntry).toEqual({ foodId: "food-1", servings: 1.5 });
    const c = withServings(
      planItemCustom("c", "Soup", {
        kcal: 100,
        proteinG: 4,
        carbsG: 10,
        fatG: 2,
      }),
      2,
    );
    expect(c.kcal).toBe(200);
    expect(c.logEntry).toMatchObject({ kcal: 200, servings: 2 });
    // `custom` stays per serving, as the server keeps it.
    expect(c.custom).toMatchObject({ kcal: 100 });
    expect(perServingOf({ ...c, servings: 0, custom: null })).toMatchObject({
      kcal: 200,
    });
  });

  it("clamps servings to the server's range", () => {
    expect(clampServings(0)).toBe(1);
    expect(clampServings(Number.NaN)).toBe(1);
    expect(clampServings(500)).toBe(100);
    expect(clampServings(1.234)).toBe(1.23);
    // A tiny amount never rounds to 0, which the server refuses.
    expect(clampServings(0.004)).toBe(0.01);
  });

  it("a full meal takes no more items (the server's 50-item cap)", () => {
    let p = draft();
    for (let i = 0; i < PLAN_ITEMS_PER_MEAL_MAX + 3; i++)
      p = addItemToMeal(p, "m1", planItemFromFood(`i${i}`, food, 1));
    expect(p.meals[0]!.items).toHaveLength(PLAN_ITEMS_PER_MEAL_MAX);
    expect(isPlanMealFull(p, "m1")).toBe(true);
    expect(isPlanMealFull(p, "m2")).toBe(false);
    expect(planMealFullText(p, "m1", 1)).toBe(
      "Breakfast is full. Pick another meal.",
    );
    expect(planMealFullText(p, "m2", 2)).toBeNull();
    const nearly = removeItem(removeItem(p, "m1", "i0"), "m1", "i1");
    expect(planMealFullText(nearly, "m1", 3)).toBe(
      "Breakfast has room for 2 more items.",
    );
    expect(planMealFullText(p, "gone", PLAN_ITEMS_PER_MEAL_MAX + 1)).toBe(
      "This meal has room for 50 more items.",
    );
  });

  it("adds, replaces and removes items with totals recomputed", () => {
    let p = addItemToMeal(draft(), "m1", planItemFromFood("i1", food, 1));
    p = addItemToMeal(p, "m1", planItemFromSavedMeal("i2", savedMeal, 1));
    expect(p.meals[0]!.items.map((i) => i.sortOrder)).toEqual([0, 1]);
    expect(p.totals.kcal).toBe(598);
    p = replaceItem(p, "m1", withServings(p.meals[0]!.items[0]!, 2));
    expect(p.totals.kcal).toBe(670);
    p = removeItem(p, "m1", "i2");
    expect(p.meals[0]!.totals.kcal).toBe(144);
    expect(firstEmptyMeal(p)!.id).toBe("m2");
    expect(
      firstEmptyMeal(addItemToMeal(p, "m2", planItemFromFood("x", food, 1))),
    ).toBeNull();
  });
});

describe("plan meals and drafts", () => {
  it("N28b ticks set the plan's meals in Your meals' order, keeping items", () => {
    const p = addItemToMeal(draft(), "m2", planItemFromFood("i1", food, 1));
    const next = withPlanMeals(
      p,
      [userMeals[1]!, userMeals[2]!],
      newId,
      userMeals,
    );
    expect(next.meals.map((m) => m.name)).toEqual(["Pre-workout", "Lunch"]);
    expect(next.meals[1]!.items).toHaveLength(1);
    expect(next.meals[0]!.id).toBe("local-n1");
  });

  it("never gives a plan more meals than the server takes", () => {
    // 30 of Your meals, all ticked (Inspector Brad, #554).
    const many: UserMeal[] = Array.from({ length: 30 }, (_, i) => ({
      ...userMeals[0]!,
      id: `um-${i}`,
      name: `Meal ${i + 1}`,
    }));
    const next = withPlanMeals(draft(), many, newId, many);
    expect(next.meals).toHaveLength(PLAN_MEALS_MAX);
    expect(next.meals[0]!.name).toBe("Meal 1");
  });

  it("at the meal cap, drops empty meals before any meal with food", () => {
    // A 20-meal plan with food in every meal that Your meals don't know
    // (a coach's), plus one new tick: the tick's empty meal goes, not food.
    const full = recomputePlan({
      ...draft(),
      meals: Array.from({ length: PLAN_MEALS_MAX }, (_, i) => ({
        ...emptyPlanMeal(`c${i}`, `Coach ${i}`, "snack", i),
        items: [planItemFromFood(`f${i}`, food, 1)],
      })),
    });
    const next = withPlanMeals(full, [userMeals[0]!], newId, userMeals);
    expect(next.meals).toHaveLength(PLAN_MEALS_MAX);
    expect(next.meals.every((m) => m.items.length === 1)).toBe(true);
    expect(next.meals.map((m) => m.id)).toContain(`c${PLAN_MEALS_MAX - 1}`);
  });

  it("keeps plan meals that aren't one of Your meals", () => {
    const p = {
      ...draft(),
      meals: [...draft().meals, emptyPlanMeal("m5", "Meal 5", "snack", 2)],
    };
    expect(
      withPlanMeals(p, [userMeals[0]!], newId, userMeals).meals.map(
        (m) => m.name,
      ),
    ).toEqual(["Breakfast", "Meal 5"]);
  });

  it("a second plan meal with a Your-meals name keeps its food (Inspector Brad #554)", () => {
    let p = {
      ...draft(),
      meals: [
        emptyPlanMeal("s1", "Snack", "snack", 0),
        emptyPlanMeal("s2", "Snack", "snack", 1),
      ],
    };
    p = addItemToMeal(p, "s1", planItemFromFood("f1", food, 1));
    p = addItemToMeal(p, "s2", planItemFromSavedMeal("f2", savedMeal, 1));
    const snack = userMeals.find((m) => m.name === "Snack")!;
    const out = withPlanMeals(p, [snack, userMeals[4]!], newId, userMeals);
    expect(out.meals.map((m) => [m.name, m.items.length])).toEqual([
      ["Snack", 1],
      ["Dinner", 0],
      ["Snack", 1],
    ]);
    // Unticking Snack drops both.
    expect(
      withPlanMeals(p, [userMeals[4]!], newId, userMeals).meals.map(
        (m) => m.name,
      ),
    ).toEqual(["Dinner"]);
  });

  it("copies a plan's meals with fresh ids", () => {
    const p = addItemToMeal(draft(), "m1", planItemFromFood("i1", food, 1));
    const copy = copyPlanMeals(p, newId);
    expect(copy[0]!.id).not.toBe("m1");
    expect(copy[0]!.items[0]!.id).not.toBe("i1");
    expect(copy[0]!.items[0]!.foodId).toBe("food-1");
  });

  it("cleans plan names", () => {
    expect(cleanPlanName("  Rest   day ")).toBe("Rest day");
    expect(cleanPlanName("   ")).toBeNull();
    expect(cleanPlanName("x".repeat(300))!.length).toBe(200);
  });

  it("starts from a day you logged: each meal with food, references kept", () => {
    const e = (over: Partial<NutritionEntry>): NutritionEntry =>
      ({
        id: "e",
        userId: "u1",
        foodId: null,
        recipeId: null,
        mealId: null,
        mealSlot: "breakfast",
        servings: 1,
        kcal: 100,
        proteinG: 1,
        carbsG: 2,
        fatG: 3,
        loggedAt: "t",
        loggedByUserId: null,
        aiEstimated: false,
        aiConfidence: null,
        customName: null,
        userMealId: null,
        ...over,
      }) as NutritionEntry;
    const day = {
      date: "2026-11-22",
      targets: null,
      consumed: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, waterCups: 0 },
      remainingKcal: 0,
      entriesBySlot: {
        breakfast: [
          e({ foodId: "food-1", servings: 2 }),
          e({ customName: "Toast" }),
        ],
        lunch: [e({ mealSlot: "lunch", recipeId: "rec-1" })],
        snack: [
          e({ mealSlot: "snack", userMealId: "um-pre", mealId: "meal-1" }),
        ],
        dinner: [e({ mealSlot: "dinner" })],
      },
    } as FuelToday;
    const meals = planMealsFromDay(day, userMeals, newId, (x) =>
      x.foodId ? "Large egg" : undefined,
    );
    expect(meals.map((m) => m.name)).toEqual([
      "Breakfast",
      "Lunch",
      "Pre-workout",
      "Dinner",
    ]);
    expect(meals[0]!.items.map((i) => [i.kind, i.name])).toEqual([
      ["food", "Large egg"],
      ["custom", "Toast"],
    ]);
    expect(meals[0]!.items[0]!.logEntry).toEqual({
      foodId: "food-1",
      servings: 2,
    });
    expect(meals[1]!.items[0]!.logEntry).toEqual({
      recipeId: "rec-1",
      servings: 1,
    });
    expect(meals[2]!.items[0]!.logEntry).toEqual({
      mealId: "meal-1",
      servings: 1,
    });
    expect(meals[3]!.items[0]!.name).toBe("Logged food");
    expect(meals[0]!.totals.kcal).toBe(200);
    // No Your meals yet: the slot names.
    expect(planMealsFromDay(day, [], newId).map((m) => m.name)).toEqual([
      "Breakfast",
      "Lunch",
      "Snack",
      "Dinner",
    ]);
  });
});

describe("reading the cache", () => {
  const a = { ...draft(), id: "a", updatedAt: "2026-11-01" };
  const b = { ...draft(), id: "b", updatedAt: "2026-11-10" };
  const c1 = { ...draft(), id: "c1" };
  const c2 = { ...draft(), id: "c2" };
  const c3 = { ...draft(), id: "c3", archivedAt: "t" };

  it("finds mine and coach plans, never removed or archived ones", () => {
    const cache: NutritionPlansCache = {
      ...emptyPlansCache(),
      mine: [a, { ...b, archivedAt: "t" }],
      fromCoaches: [
        coach(c1, "sent"),
        coach(c2, "removed"),
        coach(c3, "added"),
      ],
    };
    expect(findPlan(cache, "a")!.kind).toBe("mine");
    expect(findPlan(cache, "b")).toBeNull();
    expect(findPlan(cache, "c1")!.kind).toBe("coach");
    expect(findPlan(cache, "c2")).toBeNull();
    expect(findPlan(cache, "c3")).toBeNull();
    expect(newCoachPlans(cache).map((x) => x.plan.id)).toEqual(["c1"]);
  });

  it("opens on an added coach plan, then my newest plan, then a sent coach plan", () => {
    const base = emptyPlansCache();
    expect(defaultPlanId(base)).toBeNull();
    expect(defaultPlanId({ ...base, fromCoaches: [coach(c1, "sent")] })).toBe(
      "c1",
    );
    expect(
      defaultPlanId({
        ...base,
        mine: [a, b],
        fromCoaches: [coach(c1, "sent")],
      }),
    ).toBe("b");
    expect(
      defaultPlanId({
        ...base,
        mine: [a, b],
        fromCoaches: [coach(c2, "added")],
      }),
    ).toBe("c2");
  });

  it("merges a full read, then a delta read with deletions", () => {
    const full = mergePlansResponse(
      { ...emptyPlansCache(), conflictPlanIds: ["x"] },
      {
        mine: [a, b],
        fromCoaches: [coach(c1, "sent")],
        deletedIds: [],
        asOf: "t1",
      },
      false,
    );
    expect(full.asOf).toBe("t1");
    expect(full.conflictPlanIds).toEqual(["x"]);
    const delta = mergePlansResponse(
      full,
      {
        mine: [{ ...b, name: "Renamed" }],
        fromCoaches: [coach({ ...c1, revision: 9 }, "sent")],
        deletedIds: ["a"],
        asOf: "t2",
      },
      true,
    );
    expect(delta.mine.map((p) => [p.id, p.name])).toEqual([["b", "Renamed"]]);
    expect(delta.fromCoaches[0]!.plan.revision).toBe(9);
    expect(delta.asOf).toBe("t2");
    expect(
      mergePlansResponse(
        null,
        { mine: [], fromCoaches: [], deletedIds: [], asOf: "t" },
        true,
      ).asOf,
    ).toBe("t");
  });

  it("a plan deleted on another device stays gone even with an edit queued (Inspector Brad #554)", () => {
    const local: NutritionPlansCache = { ...emptyPlansCache(), mine: [a, b] };
    const server = mergePlansResponse(
      local,
      { mine: [], fromCoaches: [], deletedIds: ["a"], asOf: "t2" },
      true,
    );
    expect(server.serverDeletedIds).toEqual(["a"]);
    const out = overlayLocalPlans(server, local, new Set(["a"]), new Set());
    expect(out.mine.map((p) => p.id)).toEqual(["b"]);
  });

  it("keeps local intent over a read", () => {
    const server: NutritionPlansCache = {
      ...emptyPlansCache(),
      mine: [a, b],
      fromCoaches: [coach(c1, "sent"), coach(c2, "sent")],
    };
    const local: NutritionPlansCache = {
      ...emptyPlansCache(),
      mine: [
        { ...a, name: "Edited offline" },
        { ...draft(), id: "local-new" },
      ],
      fromCoaches: [{ ...coach(c1, "added"), addedAt: "now" }],
    };
    const out = overlayLocalPlans(
      server,
      local,
      new Set(["a", "b", "local-new"]),
      new Set(["c1", "c2"]),
    );
    expect(out.mine.map((p) => [p.id, p.name])).toEqual([
      ["a", "Edited offline"],
      ["local-new", "Rest day"],
    ]);
    expect(out.fromCoaches.map((x) => x.status)).toEqual(["added", "sent"]);
    expect(overlayLocalPlans(server, null, new Set(["a"]), new Set())).toBe(
      server,
    );
  });
});

describe("adding to today", () => {
  const plan = (): NutritionPlan => {
    let p = newDraftPlan({
      id: "srv-p",
      ownerId: "coach",
      name: "Training day",
      now: "t",
      meals: [
        emptyPlanMeal("srv-m1", "Pre-workout", "snack", 0),
        emptyPlanMeal("srv-m2", "Meal 5", "dinner", 1),
        emptyPlanMeal("local-m3", "Lunch", "lunch", 2),
      ],
    });
    p = addItemToMeal(p, "srv-m1", planItemFromRecipe("i1", recipe, 1));
    p = addItemToMeal(p, "srv-m2", planItemFromSavedMeal("i2", savedMeal, 1));
    p = addItemToMeal(
      p,
      "local-m3",
      planItemCustom("i3", "Wrap", {
        kcal: 450,
        proteinG: 30,
        carbsG: 50,
        fatG: 12,
      }),
    );
    return p;
  };

  it("lands in the same-named meal, else the slot's default meal", () => {
    expect(userMealForPlanMeal(plan().meals[0]!, userMeals)!.id).toBe("um-pre");
    expect(userMealForPlanMeal(plan().meals[1]!, userMeals)!.id).toBe("um-d");
    expect(userMealForPlanMeal(plan().meals[1]!, [])).toBeNull();
  });

  it("builds one entry per item with macros, meal and plan provenance", () => {
    const inputs = logInputsForPlan(
      plan(),
      userMeals,
      "2026-11-23T12:00:00.000Z",
    );
    expect(inputs).toEqual([
      expect.objectContaining({
        recipeId: "rec-1",
        mealSlot: "snack",
        userMealId: "um-pre",
        kcal: 420,
        sourcePlanId: "srv-p",
        sourcePlanMealId: "srv-m1",
      }),
      expect.objectContaining({
        mealId: "meal-1",
        userMealId: "um-d",
        kcal: 526,
      }),
      expect.objectContaining({
        customName: "Wrap",
        kcal: 450,
        userMealId: "um-l",
      }),
    ]);
    // A meal added on the phone has no server id to point at.
    expect(inputs[2]).not.toHaveProperty("sourcePlanId");
  });

  it("logs slot-only before Your meals has loaded", () => {
    const p = addItemToMeal(plan(), "srv-m1", planItemFromFood("f", food, 1));
    const inputs = logInputsForPlanMeal(p, p.meals[0]!, [], "t");
    expect(inputs[1]).toMatchObject({ foodId: "food-1", mealSlot: "snack" });
    expect(inputs[1]).not.toHaveProperty("userMealId");
  });
});

describe("shopping list", () => {
  const list = {
    aisles: [
      {
        aisle: "Meat & fish",
        items: [{ id: "a", name: "Chicken", quantity: "450 g" }],
      },
      { aisle: "Bakery", items: [{ id: "b", name: "Bagels", quantity: "2" }] },
    ],
    totalItems: 2,
    plans: [{ nutritionPlanId: "p1", mealPlanId: null, addedAt: "t" }],
    asOf: "t",
  };

  it("counts only ticks still on the list", () => {
    expect(shoppingProgress(list, ["a", "gone"])).toEqual({
      done: 1,
      total: 2,
    });
    expect(shoppingProgress(null, ["a"])).toEqual({ done: 0, total: 0 });
  });

  it("knows which plans are in it", () => {
    expect(isPlanInShoppingList(list, "p1")).toBe(true);
    expect(isPlanInShoppingList(list, "p2")).toBe(false);
    expect(isPlanInShoppingList(null, "p1")).toBe(false);
  });
});
