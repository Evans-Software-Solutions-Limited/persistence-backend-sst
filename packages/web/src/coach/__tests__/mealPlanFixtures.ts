import type {
  ClientAdherence,
  ClientMealPlans,
  ClientPlanAssignment,
  CoachRecipe,
  CoachSavedMeal,
  FoodResult,
  LibraryPlan,
  PlanItem,
} from "../api/types";

/** PER-135 fixtures: the C1 board's sample plans for Sam. */

const macros = (kcal: number, p: number, c: number, f: number) => ({
  kcal,
  proteinG: p,
  carbsG: c,
  fatG: f,
});

export function foodPlanItem(over: Partial<PlanItem> = {}): PlanItem {
  return {
    id: "i-oats",
    kind: "food",
    foodId: "food-oats",
    recipeId: null,
    mealId: null,
    name: "Porridge oats",
    servings: 1,
    sortOrder: 0,
    ...macros(300, 10, 48, 6),
    food: {
      name: "Porridge oats",
      brand: null,
      servingSize: 80,
      servingUnit: "g",
      perServing: macros(300, 10, 48, 6),
    },
    recipe: null,
    meal: null,
    custom: null,
    ...over,
  };
}

export function libraryPlan(over: Partial<LibraryPlan> = {}): LibraryPlan {
  return {
    id: "plan-train",
    ownerId: "coach-1",
    name: "Lean bulk · Training day",
    notes: null,
    source: "coach",
    revision: 3,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
    totals: macros(2476, 186, 294, 63),
    meals: [
      {
        id: "m-break",
        name: "Breakfast",
        logSlot: "breakfast",
        sortOrder: 0,
        totals: macros(548, 42, 71, 11),
        items: [
          foodPlanItem(),
          {
            ...foodPlanItem({
              id: "i-bowl",
              kind: "recipe",
              foodId: null,
              recipeId: "rec-bowl",
              name: "Chicken, rice and greens bowl",
              sortOrder: 1,
              servings: 1.5,
              ...macros(918, 60, 90, 18),
              food: null,
            }),
            recipe: {
              name: "Chicken, rice and greens bowl",
              photoUrl: null,
              servings: 4,
              perServing: macros(612, 40, 60, 12),
            },
          },
        ],
      },
      {
        id: "m-4",
        name: "Meal 4",
        logSlot: "dinner",
        sortOrder: 1,
        totals: macros(640, 38, 49, 33),
        items: [
          foodPlanItem({
            id: "i-gone",
            kind: "custom",
            foodId: null,
            name: "Salmon, potatoes and green beans",
            servings: 2,
            ...macros(1280, 76, 98, 66),
            food: null,
            custom: null,
          }),
        ],
      },
    ],
    ...over,
  };
}

export const LIBRARY_PLANS: LibraryPlan[] = [
  libraryPlan(),
  libraryPlan({
    id: "plan-rest",
    name: "Lean bulk · Rest day",
    totals: macros(2310, 172, 228, 72),
    meals: [],
  }),
];

export function assignment(
  over: Partial<ClientPlanAssignment> = {},
): ClientPlanAssignment {
  return {
    id: "asg-train",
    planId: "plan-train",
    note: "Use this on lifting days.",
    status: "added",
    seenRevision: 3,
    sentAt: "2026-10-21T09:00:00.000Z",
    addedAt: "2026-10-21T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:00.000Z",
    plan: LIBRARY_PLANS[0]!,
    updatedSinceSeen: false,
    usedDays: 9,
    loggedThisWeek: 12,
    ...over,
  };
}

export const CLIENT_MEAL_PLANS: ClientMealPlans = {
  assignments: [
    assignment(),
    assignment({
      id: "asg-rest",
      planId: "plan-rest",
      plan: LIBRARY_PLANS[1]!,
      status: "sent",
      // The server sets seenRevision to the plan's revision on send.
      seenRevision: 3,
      sentAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      addedAt: null,
      usedDays: 0,
      loggedThisWeek: 7,
    }),
  ],
  target: {
    dailyKcal: 2500,
    proteinG: 180,
    carbsG: 300,
    fatG: 70,
    setByUserId: "coach-1",
  },
  asOf: "2026-11-26T10:00:00.000Z",
};

export const RECIPES: CoachRecipe[] = [
  {
    id: "rec-bowl",
    name: "Chicken, rice and greens bowl",
    photoUrl: null,
    servings: 4,
    source: "manual",
    sourceUrl: null,
    totalKcal: 2448,
    totalProteinG: 160,
    totalCarbsG: 240,
    totalFatG: 48,
  },
  {
    id: "rec-chilli",
    name: "Turkey chilli with rice",
    photoUrl: null,
    servings: 6,
    source: "import",
    sourceUrl: "https://example.com/chilli",
    totalKcal: 3912,
    totalProteinG: 300,
    totalCarbsG: 360,
    totalFatG: 90,
  },
];

export const SAVED_MEALS: CoachSavedMeal[] = [
  {
    id: "meal-yog",
    name: "Greek yoghurt and granola",
    photoUrl: null,
    totalKcal: 214,
    totalProteinG: 18,
    totalCarbsG: 24,
    totalFatG: 5,
  },
];

export const FOODS: FoodResult[] = [
  {
    id: "food-salmon",
    name: "Salmon fillet",
    brand: null,
    kcal: 206,
    proteinG: 22,
    carbsG: 0,
    fatG: 13,
    servingSize: 100,
    servingUnit: "g",
  },
  {
    id: "food-cod",
    name: "Cod loin",
    brand: "Fishmonger",
    kcal: 82,
    proteinG: 18,
    carbsG: 0,
    fatG: 1,
    servingSize: 100,
    servingUnit: "g",
  },
];

export const ADHERENCE: ClientAdherence = {
  asOf: "2026-11-26T10:00:00.000Z",
  calories: {
    from: "2026-11-19",
    to: "2026-11-25",
    daysOnTarget: 5,
    daysCounted: 7,
    daysNotLogged: 1,
  },
};
