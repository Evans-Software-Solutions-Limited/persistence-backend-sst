import {
  computePlanAdherence,
  heldTotalsExcluding,
  nextUnloggedPlanMeal,
  planAcceptMealInputFromGenerated,
  planDraftFromResult,
  planDraftHasFlaggedMeal,
  planDraftMealsAffectedBy,
  planDraftToAcceptInput,
  plannedMealsForSlot,
  recomputePlanMealTotals,
  removePlanDraftMeal,
  replacePlanDraftMeal,
  setPlanItemServings,
  sumPlanDraftTotals,
  unresolvableCandidateIds,
  type MealPlan,
  type PlanDraft,
  type PlanGeneratedItem,
  type PlanGeneratedMeal,
  type PlanGenerateResult,
} from "../mealprint";

function item(over: Partial<PlanGeneratedItem> = {}): PlanGeneratedItem {
  return {
    candidateId: "food-1",
    kind: "food",
    servings: 1,
    name: "Chicken breast",
    kcal: 200,
    proteinG: 30,
    carbsG: 0,
    fatG: 5,
    ...over,
  };
}

function meal(over: Partial<PlanGeneratedMeal> = {}): PlanGeneratedMeal {
  return {
    name: "Chicken & rice bowl",
    reason: "High protein, fits the rest of your macros.",
    logSlot: "dinner",
    items: [
      item({
        candidateId: "food-1",
        servings: 1.5,
        name: "Chicken breast",
        kcal: 200,
        proteinG: 30,
        carbsG: 0,
        fatG: 5,
      }),
      item({
        candidateId: "food-2",
        servings: 1,
        name: "Basmati rice",
        kcal: 150,
        proteinG: 3,
        carbsG: 33,
        fatG: 1,
      }),
    ],
    kcal: 600,
    proteinG: 45,
    carbsG: 60,
    fatG: 15,
    containsUnverified: false,
    flaggedUnsafe: false,
    ...over,
  };
}

function generateResult(
  meals: PlanGeneratedMeal[],
  over: Partial<PlanGenerateResult> = {},
): PlanGenerateResult {
  return {
    meals,
    emptyReason: null,
    target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
    totals: { kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 },
    withinTolerance: false,
    labelCheckRequired: true,
    ...over,
  };
}

function plan(over: Partial<MealPlan> = {}): MealPlan {
  return {
    id: "plan-1",
    userId: "user-1",
    status: "active",
    planDate: "2026-08-05",
    groupId: null,
    mealsPerDay: 2,
    effortLevel: "balanced",
    targetKcal: 2200,
    targetProteinG: 160,
    targetCarbsG: 220,
    targetFatG: 70,
    source: "ai",
    createdByUserId: null,
    createdAt: "2026-08-05T08:00:00.000Z",
    acceptedAt: "2026-08-05T08:00:00.000Z",
    meals: [
      {
        id: "meal-1",
        sortOrder: 0,
        label: "Greek yoghurt bowl",
        logSlot: "breakfast",
        recipeId: null,
        mealId: null,
        items: null,
        kcal: 400,
        proteinG: 30,
        carbsG: 40,
        fatG: 10,
        aiReason: null,
        state: "logged",
        loggedEntryId: "entry-1",
      },
      {
        id: "meal-2",
        sortOrder: 1,
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
      },
    ],
    ...over,
  };
}

describe("planDraftFromResult", () => {
  it("returns null when the result carries no target (an empty answer)", () => {
    const result = generateResult([], { target: null, meals: [] });
    expect(planDraftFromResult("2026-08-05", result, () => "id")).toBeNull();
  });

  it("assigns a stable local id per meal, in order", () => {
    let n = 0;
    const idFactory = () => `local-${++n}`;
    const result = generateResult([meal(), meal({ name: "Salad" })]);
    const draft = planDraftFromResult("2026-08-05", result, idFactory);
    expect(draft).not.toBeNull();
    expect(draft!.meals.map((m) => m.localId)).toEqual(["local-1", "local-2"]);
    expect(draft!.meals.map((m) => m.meal.name)).toEqual([
      "Chicken & rice bowl",
      "Salad",
    ]);
    expect(draft!.target).toEqual(result.target);
  });
});

describe("sumPlanDraftTotals — deterministic recompute (load-bearing)", () => {
  it("sums the kept meals' already-verified macros exactly", () => {
    const draft: PlanDraft = {
      planDate: "2026-08-05",
      target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
      meals: [
        {
          localId: "a",
          meal: meal({ kcal: 400, proteinG: 30, carbsG: 40, fatG: 10 }),
        },
        {
          localId: "b",
          meal: meal({ kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 }),
        },
      ],
    };
    expect(sumPlanDraftTotals(draft.meals)).toEqual({
      kcal: 1000,
      proteinG: 75,
      carbsG: 100,
      fatG: 25,
    });
  });

  it("is exact after removing a meal — this is the 'edit' the mobile build offers pre-accept", () => {
    // This test is load-bearing: revert `removePlanDraftMeal`'s filter (e.g.
    // keep every meal) and this assertion fails, proving the recompute is
    // wired to the ACTUAL kept set rather than a stale total.
    const draft: PlanDraft = {
      planDate: "2026-08-05",
      target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
      meals: [
        {
          localId: "a",
          meal: meal({ kcal: 400, proteinG: 30, carbsG: 40, fatG: 10 }),
        },
        {
          localId: "b",
          meal: meal({ kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 }),
        },
      ],
    };
    const next = removePlanDraftMeal(draft, "b");
    expect(next.meals).toHaveLength(1);
    expect(sumPlanDraftTotals(next.meals)).toEqual({
      kcal: 400,
      proteinG: 30,
      carbsG: 40,
      fatG: 10,
    });
  });

  it("returns zeros for an empty meal list", () => {
    expect(sumPlanDraftTotals([])).toEqual({
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });
});

describe("recomputePlanMealTotals — deterministic client-side recompute (AC 4.4)", () => {
  it("sums each item's per-serving macros × servings", () => {
    const m = meal({
      items: [
        item({
          candidateId: "food-1",
          servings: 2,
          kcal: 200,
          proteinG: 20,
          carbsG: 10,
          fatG: 5,
        }),
        item({
          candidateId: "food-2",
          servings: 1,
          kcal: 150,
          proteinG: 5,
          carbsG: 30,
          fatG: 1,
        }),
      ],
    });
    const result = recomputePlanMealTotals(m);
    // (200*2 + 150*1) = 550, (20*2 + 5*1) = 45, (10*2 + 30*1) = 50, (5*2 + 1*1) = 11
    expect(result.kcal).toBe(550);
    expect(result.proteinG).toBe(45);
    expect(result.carbsG).toBe(50);
    expect(result.fatG).toBe(11);
    // Everything else on the meal is untouched.
    expect(result.name).toBe(m.name);
    expect(result.items).toBe(m.items);
  });

  it("rounds to one decimal place, matching the server's own convention", () => {
    const m = meal({
      items: [item({ candidateId: "food-1", servings: 1 / 3, kcal: 100 })],
    });
    expect(recomputePlanMealTotals(m).kcal).toBe(33.3);
  });
});

describe("setPlanItemServings — the serving stepper's core operation (AC 4.4)", () => {
  it("updates ONE item's servings and re-sums the meal totals", () => {
    const m = meal({
      items: [
        item({
          candidateId: "food-1",
          servings: 1,
          kcal: 200,
          proteinG: 20,
          carbsG: 10,
          fatG: 5,
        }),
        item({
          candidateId: "food-2",
          servings: 1,
          kcal: 150,
          proteinG: 5,
          carbsG: 30,
          fatG: 1,
        }),
      ],
    });
    const result = setPlanItemServings(m, "food-1", 2);
    const changed = result.items.find((i) => i.candidateId === "food-1")!;
    expect(changed.servings).toBe(2);
    // Untouched item stays at its own servings.
    const other = result.items.find((i) => i.candidateId === "food-2")!;
    expect(other.servings).toBe(1);
    // (200*2 + 150*1) = 550
    expect(result.kcal).toBe(550);
  });

  it("clamps below the minimum servings", () => {
    const m = meal({ items: [item({ candidateId: "food-1", kcal: 100 })] });
    const result = setPlanItemServings(m, "food-1", 0);
    expect(result.items[0]!.servings).toBe(0.25);
  });

  it("clamps above the maximum servings", () => {
    const m = meal({ items: [item({ candidateId: "food-1", kcal: 100 })] });
    const result = setPlanItemServings(m, "food-1", 99);
    expect(result.items[0]!.servings).toBe(6);
  });

  it("is a no-op on servings when the candidateId doesn't match any item", () => {
    const m = meal();
    const result = setPlanItemServings(m, "nonexistent", 3);
    expect(result.items.map((i) => i.servings)).toEqual(
      m.items.map((i) => i.servings),
    );
  });
});

describe("replacePlanDraftMeal", () => {
  it("swaps in the new meal at the same localId, leaving others untouched", () => {
    const draft: PlanDraft = {
      planDate: "2026-08-05",
      target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
      meals: [
        { localId: "a", meal: meal({ name: "Original" }) },
        { localId: "b", meal: meal({ name: "Other" }) },
      ],
    };
    const swapped = meal({ name: "Swapped in", kcal: 500 });
    const next = replacePlanDraftMeal(draft, "a", swapped);
    expect(next.meals[0]!.meal.name).toBe("Swapped in");
    expect(next.meals[0]!.meal.kcal).toBe(500);
    expect(next.meals[1]!.meal.name).toBe("Other");
  });
});

describe("heldTotalsExcluding", () => {
  it("sums every OTHER meal's macros — what a swap's heldTotals holds", () => {
    const draft: PlanDraft = {
      planDate: "2026-08-05",
      target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
      meals: [
        {
          localId: "a",
          meal: meal({ kcal: 400, proteinG: 30, carbsG: 40, fatG: 10 }),
        },
        {
          localId: "b",
          meal: meal({ kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 }),
        },
        {
          localId: "c",
          meal: meal({ kcal: 300, proteinG: 20, carbsG: 30, fatG: 8 }),
        },
      ],
    };
    // Excluding "b" — held is a + c.
    expect(heldTotalsExcluding(draft, "b")).toEqual({
      kcal: 700,
      proteinG: 50,
      carbsG: 70,
      fatG: 18,
    });
  });
});

describe("planDraftHasFlaggedMeal", () => {
  it("is true when any meal is flaggedUnsafe", () => {
    const meals = [
      { localId: "a", meal: meal({ flaggedUnsafe: false }) },
      { localId: "b", meal: meal({ flaggedUnsafe: true }) },
    ];
    expect(planDraftHasFlaggedMeal(meals)).toBe(true);
  });

  it("is false when none are flagged", () => {
    const meals = [{ localId: "a", meal: meal({ flaggedUnsafe: false }) }];
    expect(planDraftHasFlaggedMeal(meals)).toBe(false);
  });
});

describe("planAcceptMealInputFromGenerated — accept sends REFERENCES, never macros (load-bearing)", () => {
  it("carries only label/logSlot/items(foodId+servings)/aiReason — no kcal/protein/carbs/fat", () => {
    const input = planAcceptMealInputFromGenerated(meal());
    expect(input).toEqual({
      label: "Chicken & rice bowl",
      logSlot: "dinner",
      items: [
        { foodId: "food-1", servings: 1.5 },
        { foodId: "food-2", servings: 1 },
      ],
      aiReason: "High protein, fits the rest of your macros.",
    });
    // The load-bearing assertion: reverting this function to also copy
    // `kcal`/`proteinG`/etc. across (trusting the client's numbers) would
    // pass every OTHER assertion in this file but fail this one.
    expect(input).not.toHaveProperty("kcal");
    expect(input).not.toHaveProperty("proteinG");
    expect(input).not.toHaveProperty("carbsG");
    expect(input).not.toHaveProperty("fatG");
  });
});

describe("planAcceptMealInputFromGenerated — routes by kind (mealprint item-kind gap)", () => {
  it("routes a recipe-kind item to recipeId + servings, not items[]", () => {
    const input = planAcceptMealInputFromGenerated(
      meal({
        items: [
          item({ candidateId: "recipe-1", kind: "recipe", servings: 1.5 }),
        ],
      }),
    );
    expect(input).toEqual({
      label: "Chicken & rice bowl",
      logSlot: "dinner",
      recipeId: "recipe-1",
      servings: 1.5,
      aiReason: "High protein, fits the rest of your macros.",
    });
    expect(input).not.toHaveProperty("items");
    expect(input).not.toHaveProperty("mealId");
  });

  it("routes a meal-kind item to mealId + servings, not items[]", () => {
    const input = planAcceptMealInputFromGenerated(
      meal({
        items: [item({ candidateId: "meal-1", kind: "meal", servings: 1 })],
      }),
    );
    expect(input).toEqual({
      label: "Chicken & rice bowl",
      logSlot: "dinner",
      mealId: "meal-1",
      servings: 1,
      aiReason: "High protein, fits the rest of your macros.",
    });
    expect(input).not.toHaveProperty("items");
    expect(input).not.toHaveProperty("recipeId");
  });

  it("keeps a recipe PLUS extra food items — both recipeId and items[] populated", () => {
    const input = planAcceptMealInputFromGenerated(
      meal({
        items: [
          item({ candidateId: "recipe-1", kind: "recipe", servings: 1 }),
          item({ candidateId: "food-9", kind: "food", servings: 2 }),
        ],
      }),
    );
    expect(input.recipeId).toBe("recipe-1");
    expect(input.servings).toBe(1);
    expect(input.items).toEqual([{ foodId: "food-9", servings: 2 }]);
  });

  it("keeps only the FIRST recipe-kind item when a meal somehow carries two — a pre-existing accept-schema limit, not silently corrupting the rest", () => {
    const input = planAcceptMealInputFromGenerated(
      meal({
        items: [
          item({ candidateId: "recipe-1", kind: "recipe", servings: 1 }),
          item({ candidateId: "recipe-2", kind: "recipe", servings: 1 }),
        ],
      }),
    );
    expect(input.recipeId).toBe("recipe-1");
  });

  it("defaults an item with a MISSING kind to food — deploy skew must not store a silent empty meal", () => {
    // A backend that has not yet shipped the kind-stamping handlers returns
    // items with no `kind`. Routing those to nothing would degrade the meal to
    // zero items / zero macros and store a silent 0-kcal meal. The pre-kind
    // behaviour sent every item as a foodId; this must still do that.
    const legacyItem = {
      candidateId: "food-legacy",
      servings: 2,
      name: "Grilled chicken",
    } as unknown as PlanGeneratedItem; // no `kind` on the wire
    const input = planAcceptMealInputFromGenerated(
      meal({ items: [legacyItem] }),
    );
    expect(input.items).toEqual([{ foodId: "food-legacy", servings: 2 }]);
    expect(input).not.toHaveProperty("recipeId");
    expect(input).not.toHaveProperty("mealId");
  });
});

describe("planDraftToAcceptInput", () => {
  it("maps every draft meal through planAcceptMealInputFromGenerated, in order", () => {
    const draft: PlanDraft = {
      planDate: "2026-08-05",
      target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
      meals: [
        { localId: "a", meal: meal({ name: "First" }) },
        { localId: "b", meal: meal({ name: "Second", logSlot: "lunch" }) },
      ],
    };
    const input = planDraftToAcceptInput(draft);
    expect(input.planDate).toBe("2026-08-05");
    expect(input.meals).toHaveLength(2);
    expect(input.meals[0]!.label).toBe("First");
    expect(input.meals[1]!.logSlot).toBe("lunch");
  });
});

describe("unresolvableCandidateIds / planDraftMealsAffectedBy", () => {
  it("strips the kind prefix off each entry", () => {
    const ids = unresolvableCandidateIds(["food:abc", "recipe:def", "raw-id"]);
    expect(ids).toEqual(new Set(["abc", "def", "raw-id"]));
  });

  it("identifies exactly the draft meals referencing an unresolvable id", () => {
    const draft: PlanDraft = {
      planDate: "2026-08-05",
      target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
      meals: [
        {
          localId: "a",
          meal: meal({
            items: [item({ candidateId: "food-1", name: "x" })],
          }),
        },
        {
          localId: "b",
          meal: meal({
            items: [item({ candidateId: "food-9", name: "y" })],
          }),
        },
      ],
    };
    const unresolvable = unresolvableCandidateIds(["food:food-9"]);
    expect(planDraftMealsAffectedBy(draft, unresolvable)).toEqual(
      new Set(["b"]),
    );
  });
});

describe("computePlanAdherence", () => {
  it("sums only the LOGGED meals, and counts logged/total", () => {
    const adherence = computePlanAdherence(plan());
    expect(adherence.loggedCount).toBe(1);
    expect(adherence.totalCount).toBe(2);
    expect(adherence.loggedTotals).toEqual({
      kcal: 400,
      proteinG: 30,
      carbsG: 40,
      fatG: 10,
    });
  });
});

describe("nextUnloggedPlanMeal", () => {
  it("returns the first PLANNED meal by sortOrder", () => {
    const next = nextUnloggedPlanMeal(plan());
    expect(next?.id).toBe("meal-2");
  });

  it("sorts multiple planned meals by sortOrder, not array order", () => {
    const base = plan().meals[1]!;
    const outOfOrder = plan({
      meals: [
        { ...base, id: "later", sortOrder: 2, logSlot: "snack" },
        { ...base, id: "earlier", sortOrder: 1 },
      ],
    });
    expect(nextUnloggedPlanMeal(outOfOrder)?.id).toBe("earlier");
  });

  it("returns null when every meal is logged", () => {
    const allLogged = plan({
      meals: plan().meals.map((m) => ({ ...m, state: "logged" as const })),
    });
    expect(nextUnloggedPlanMeal(allLogged)).toBeNull();
  });
});

describe("plannedMealsForSlot — the Fuel ghost rows (AC 5.1)", () => {
  it("returns only PLANNED meals mapped to the requested slot", () => {
    expect(plannedMealsForSlot(plan(), "dinner").map((m) => m.id)).toEqual([
      "meal-2",
    ]);
    // Already logged — must NOT appear as a ghost row.
    expect(plannedMealsForSlot(plan(), "breakfast")).toEqual([]);
  });

  it("sorts multiple ghost rows in the same slot by sortOrder", () => {
    const base = plan().meals[1]!;
    const twoInSlot = plan({
      meals: [
        { ...base, id: "second", sortOrder: 2 },
        { ...base, id: "first", sortOrder: 1 },
      ],
    });
    expect(plannedMealsForSlot(twoInSlot, "dinner").map((m) => m.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("returns an empty array when there's no plan", () => {
    expect(plannedMealsForSlot(null, "dinner")).toEqual([]);
  });
});
