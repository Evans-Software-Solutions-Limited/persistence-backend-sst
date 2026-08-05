import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { logPlanMealCommand } from "../mealPlan.command";
import type { MealPlan, PlanMeal } from "@/domain/models/mealprint";

const USER = "user-1";

function plan(over: Partial<MealPlan> = {}): MealPlan {
  return {
    id: "plan-1",
    userId: USER,
    status: "active",
    planDate: "2026-08-05",
    groupId: null,
    mealsPerDay: 1,
    effortLevel: "balanced",
    targetKcal: 2200,
    targetProteinG: 160,
    targetCarbsG: 220,
    targetFatG: 70,
    source: "ai",
    createdByUserId: null,
    createdAt: null,
    acceptedAt: null,
    meals: [mealFixture()],
    ...over,
  };
}

function mealFixture(over: Partial<PlanMeal> = {}): PlanMeal {
  return {
    id: "meal-1",
    sortOrder: 0,
    label: "Chicken & rice bowl",
    logSlot: "dinner",
    recipeId: null,
    mealId: null,
    items: null,
    kcal: 600,
    proteinG: 45,
    carbsG: 60,
    fatG: 15,
    aiReason: null,
    state: "planned",
    loggedEntryId: null,
    ...over,
  };
}

describe("logPlanMealCommand — offline-queued plan-meal log (AC 5.2, load-bearing)", () => {
  it("flips the cached plan meal to logged and stamps a local loggedEntryId", () => {
    const storage = new InMemoryStorageAdapter();
    const activePlan = plan();
    storage.cacheMealPlan(USER, activePlan);

    const entry = logPlanMealCommand(
      { storage, userId: USER, idFactory: () => "abc123" },
      { plan: activePlan, meal: activePlan.meals[0]! },
    );

    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("local-abc123");

    const cached = storage.getCachedActiveMealPlan(USER, "2026-08-05");
    expect(cached!.meals[0]!.state).toBe("logged");
    expect(cached!.meals[0]!.loggedEntryId).toBe("local-abc123");
  });

  it("writes the diary entry into the day aggregate with the plan meal's DENORMALISED macros", () => {
    // Load-bearing: revert this to recompute from a food/recipe reference and
    // this assertion fails, because a plan meal composed of several items has
    // no single food/recipe row to recompute from — the macros MUST come
    // straight off the plan meal, unchanged.
    const storage = new InMemoryStorageAdapter();
    const activePlan = plan();
    storage.cacheMealPlan(USER, activePlan);

    logPlanMealCommand(
      { storage, userId: USER, idFactory: () => "xyz" },
      { plan: activePlan, meal: activePlan.meals[0]! },
    );

    const fuel = storage.getCachedFuelToday(USER, "2026-08-05");
    expect(fuel).not.toBeNull();
    expect(fuel!.entriesBySlot.dinner).toHaveLength(1);
    const row = fuel!.entriesBySlot.dinner[0]!;
    expect(row.kcal).toBe(600);
    expect(row.proteinG).toBe(45);
    expect(row.customName).toBe("Chicken & rice bowl");
    expect(row.loggedAt).toBe("2026-08-05T12:00:00.000Z");
  });

  it("carries the recipe/meal id and a null customName for a recipe-backed plan meal", () => {
    const storage = new InMemoryStorageAdapter();
    const backed = mealFixture({ recipeId: "recipe-1" });
    const activePlan = plan({ meals: [backed] });
    storage.cacheMealPlan(USER, activePlan);

    logPlanMealCommand(
      { storage, userId: USER, idFactory: () => "r1" },
      { plan: activePlan, meal: backed },
    );

    const fuel = storage.getCachedFuelToday(USER, "2026-08-05");
    const row = fuel!.entriesBySlot.dinner[0]!;
    expect(row.recipeId).toBe("recipe-1");
    expect(row.customName).toBeNull();
  });

  it("enqueues POST .../meals/:mealId/log with an empty payload", () => {
    const storage = new InMemoryStorageAdapter();
    const activePlan = plan();
    storage.cacheMealPlan(USER, activePlan);

    logPlanMealCommand(
      { storage, userId: USER, idFactory: () => "q1" },
      { plan: activePlan, meal: activePlan.meals[0]! },
    );

    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      entityType: "meal_plan_log",
      entityId: "meal-1",
      operation: "update",
      endpoint: "/nutrition/plans/plan-1/meals/meal-1/log",
      method: "POST",
    });
  });

  it("is a no-op (mutates nothing, enqueues nothing) when the meal is already logged", () => {
    // ⚠ Destructive-default discipline: a double tap must never double-log or
    // re-queue a request for a meal that's already settled.
    const storage = new InMemoryStorageAdapter();
    const logged = mealFixture({ state: "logged", loggedEntryId: "entry-9" });
    const activePlan = plan({ meals: [logged] });
    storage.cacheMealPlan(USER, activePlan);

    const entry = logPlanMealCommand(
      { storage, userId: USER, idFactory: () => "should-not-run" },
      { plan: activePlan, meal: logged },
    );

    expect(entry).toBeNull();
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(storage.getCachedFuelToday(USER, "2026-08-05")).toBeNull();
  });

  it("preserves the existing target when the day aggregate is not yet cached", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheNutritionTarget(USER, {
      userId: USER,
      dailyKcal: 2000,
      proteinG: 150,
      carbsG: 200,
      fatG: 60,
      waterCups: 8,
      preset: null,
      setByUserId: null,
      setByName: null,
      updatedAt: null,
    });
    const activePlan = plan();
    storage.cacheMealPlan(USER, activePlan);

    logPlanMealCommand(
      { storage, userId: USER, idFactory: () => "t1" },
      { plan: activePlan, meal: activePlan.meals[0]! },
    );

    const fuel = storage.getCachedFuelToday(USER, "2026-08-05");
    expect(fuel!.targets?.dailyKcal).toBe(2000);
  });
});
