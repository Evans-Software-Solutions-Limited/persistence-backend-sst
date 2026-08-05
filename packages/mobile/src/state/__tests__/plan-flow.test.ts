import { usePlanFlow } from "@/state/plan-flow";
import type {
  PlanGenerateResult,
  PlanSwapMeal,
} from "@/domain/models/mealprint";

function result(over: Partial<PlanGenerateResult> = {}): PlanGenerateResult {
  return {
    meals: [
      {
        name: "Chicken & rice bowl",
        reason: "protein",
        logSlot: "dinner",
        items: [
          {
            candidateId: "food-1",
            kind: "food",
            servings: 1,
            name: "Chicken",
            kcal: 600,
            proteinG: 45,
            carbsG: 60,
            fatG: 15,
          },
        ],
        kcal: 600,
        proteinG: 45,
        carbsG: 60,
        fatG: 15,
        containsUnverified: false,
        flaggedUnsafe: false,
      },
    ],
    emptyReason: null,
    target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
    totals: { kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 },
    withinTolerance: false,
    labelCheckRequired: true,
    ...over,
  };
}

beforeEach(() => {
  usePlanFlow.getState().reset();
});

const get = () => usePlanFlow.getState();

describe("usePlanFlow — open/close", () => {
  it("starts closed", () => {
    expect(get().step).toBeNull();
    expect(get().draft).toBeNull();
  });

  it("opens at config with the given date, resetting any prior draft/flags", () => {
    get().open("2026-08-05");
    expect(get().step).toBe("config");
    expect(get().planDate).toBe("2026-08-05");
    expect(get().draft).toBeNull();
    expect(get().flaggedIds.size).toBe(0);
  });

  it("close resets everything", () => {
    get().open("2026-08-05");
    get().generating();
    get().close();
    expect(get().step).toBeNull();
    expect(get().draft).toBeNull();
  });
});

describe("usePlanFlow — generate → draft", () => {
  it("draftReady assigns a localId per meal and moves to the draft step", () => {
    get().open("2026-08-05");
    get().generating();
    expect(get().step).toBe("generating");
    get().draftReady(result());
    expect(get().step).toBe("draft");
    expect(get().draft?.meals).toHaveLength(1);
    expect(get().draft?.meals[0]!.localId).toEqual(expect.any(String));
  });

  it("a server-flagged meal is added to flaggedIds on draftReady", () => {
    get().open("2026-08-05");
    get().draftReady(
      result({
        meals: [
          {
            name: "Something",
            reason: "x",
            logSlot: "lunch",
            items: [],
            kcal: 500,
            proteinG: 40,
            carbsG: 40,
            fatG: 10,
            containsUnverified: false,
            flaggedUnsafe: true,
          },
        ],
      }),
    );
    expect(get().flaggedIds.size).toBe(1);
    const localId = get().draft!.meals[0]!.localId;
    expect(get().flaggedIds.has(localId)).toBe(true);
  });

  it("empty() records the reason and returns to config", () => {
    get().open("2026-08-05");
    get().generating();
    get().empty("no_candidates");
    expect(get().step).toBe("config");
    expect(get().emptyReason).toBe("no_candidates");
  });

  it("draftReady with no target falls back to config with no draft", () => {
    get().open("2026-08-05");
    get().draftReady(result({ target: null }));
    expect(get().step).toBe("config");
    expect(get().draft).toBeNull();
  });
});

describe("usePlanFlow — no-op guards on a null draft", () => {
  it("removeMeal/swapApplied/markUnresolvable are no-ops before a draft exists", () => {
    get().open("2026-08-05");
    expect(get().draft).toBeNull();

    get().removeMeal("nonexistent");
    expect(get().draft).toBeNull();

    get().swapApplied("nonexistent", {
      name: "x",
      reason: "y",
      logSlot: "dinner",
      items: [],
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      containsUnverified: false,
    });
    expect(get().draft).toBeNull();
    expect(get().swappingId).toBeNull();

    get().markUnresolvable(["food:x"]);
    expect(get().flaggedIds.size).toBe(0);
  });
});

describe("usePlanFlow — removeMeal (deterministic edit)", () => {
  it("removes exactly the targeted meal and its flag", () => {
    get().open("2026-08-05");
    get().draftReady(
      result({
        meals: [
          {
            name: "A",
            reason: "x",
            logSlot: "breakfast",
            items: [],
            kcal: 300,
            proteinG: 20,
            carbsG: 30,
            fatG: 8,
            containsUnverified: false,
            flaggedUnsafe: true,
          },
          {
            name: "B",
            reason: "y",
            logSlot: "dinner",
            items: [],
            kcal: 600,
            proteinG: 45,
            carbsG: 60,
            fatG: 15,
            containsUnverified: false,
            flaggedUnsafe: false,
          },
        ],
      }),
    );
    const [aId, bId] = get().draft!.meals.map((m) => m.localId);
    expect(get().flaggedIds.has(aId!)).toBe(true);

    get().removeMeal(aId!);
    expect(get().draft!.meals).toHaveLength(1);
    expect(get().draft!.meals[0]!.localId).toBe(bId);
    expect(get().flaggedIds.has(aId!)).toBe(false);
  });
});

describe("usePlanFlow — updateItemServings (serving stepper, AC 4.4)", () => {
  it("recomputes the meal's totals from the new servings, deterministically", () => {
    get().open("2026-08-05");
    get().draftReady(result());
    const localId = get().draft!.meals[0]!.localId;

    get().updateItemServings(localId, "food-1", 2);

    const meal = get().draft!.meals[0]!.meal;
    expect(meal.items[0]!.servings).toBe(2);
    // 600 kcal/serving (the fixture's per-serving figure) × 2.
    expect(meal.kcal).toBe(1200);
  });

  it("is a no-op before a draft exists", () => {
    get().open("2026-08-05");
    expect(get().draft).toBeNull();
    get().updateItemServings("nonexistent", "food-1", 2);
    expect(get().draft).toBeNull();
  });

  it("is a no-op for a localId that isn't in the draft", () => {
    get().open("2026-08-05");
    get().draftReady(result());
    const before = get().draft;
    get().updateItemServings("nonexistent-meal", "food-1", 2);
    expect(get().draft).toBe(before);
  });
});

describe("usePlanFlow — swap", () => {
  const swapMeal: PlanSwapMeal = {
    name: "Salmon & greens",
    reason: "omega-3",
    logSlot: "dinner",
    items: [
      {
        candidateId: "food-2",
        kind: "food",
        servings: 1,
        name: "Salmon",
        kcal: 500,
        proteinG: 40,
        carbsG: 20,
        fatG: 20,
      },
    ],
    kcal: 500,
    proteinG: 40,
    carbsG: 20,
    fatG: 20,
    containsUnverified: false,
  };

  it("beginSwap marks the meal as swapping; swapApplied replaces it and clears the flag", () => {
    get().open("2026-08-05");
    get().draftReady(
      result({
        meals: [
          {
            name: "Original",
            reason: "x",
            logSlot: "dinner",
            items: [],
            kcal: 600,
            proteinG: 45,
            carbsG: 60,
            fatG: 15,
            containsUnverified: false,
            flaggedUnsafe: true,
          },
        ],
      }),
    );
    const localId = get().draft!.meals[0]!.localId;
    expect(get().flaggedIds.has(localId)).toBe(true);

    get().beginSwap(localId);
    expect(get().swappingId).toBe(localId);

    get().swapApplied(localId, swapMeal);
    expect(get().swappingId).toBeNull();
    expect(get().draft!.meals[0]!.meal.name).toBe("Salmon & greens");
    expect(get().draft!.meals[0]!.meal.flaggedUnsafe).toBe(false);
    // A fresh swap clears the flag — the whole point of swapping it out.
    expect(get().flaggedIds.has(localId)).toBe(false);
  });

  it("swapAbandoned clears swappingId without touching the draft", () => {
    get().open("2026-08-05");
    get().draftReady(result());
    const localId = get().draft!.meals[0]!.localId;
    get().beginSwap(localId);
    get().swapAbandoned();
    expect(get().swappingId).toBeNull();
    expect(get().draft!.meals[0]!.localId).toBe(localId);
  });
});

describe("usePlanFlow — markUnresolvable (accept-time flagging)", () => {
  it("flags exactly the meal whose candidateId matches an unresolvable id", () => {
    get().open("2026-08-05");
    get().draftReady(
      result({
        meals: [
          {
            name: "Has the stale id",
            reason: "x",
            logSlot: "lunch",
            items: [
              {
                candidateId: "stale-id",
                kind: "food",
                servings: 1,
                name: "x",
                kcal: 400,
                proteinG: 30,
                carbsG: 40,
                fatG: 10,
              },
            ],
            kcal: 400,
            proteinG: 30,
            carbsG: 40,
            fatG: 10,
            containsUnverified: false,
            flaggedUnsafe: false,
          },
        ],
      }),
    );
    const localId = get().draft!.meals[0]!.localId;
    expect(get().flaggedIds.size).toBe(0);

    get().markUnresolvable(["food:stale-id"]);
    expect(get().flaggedIds.has(localId)).toBe(true);
  });
});

describe("usePlanFlow — accepted", () => {
  it("moves to saved, stores the plan, and bumps rev", () => {
    get().open("2026-08-05");
    const startRev = get().rev;
    const plan = {
      id: "plan-1",
      userId: "user-1",
      status: "active" as const,
      planDate: "2026-08-05",
      groupId: null,
      mealsPerDay: 1,
      effortLevel: "balanced" as const,
      targetKcal: 2200,
      targetProteinG: 160,
      targetCarbsG: 220,
      targetFatG: 70,
      source: "ai",
      createdByUserId: null,
      createdAt: null,
      acceptedAt: null,
      meals: [],
    };
    get().accepted(plan);
    expect(get().step).toBe("saved");
    expect(get().acceptedPlan).toEqual(plan);
    expect(get().rev).toBe(startRev + 1);
  });
});
