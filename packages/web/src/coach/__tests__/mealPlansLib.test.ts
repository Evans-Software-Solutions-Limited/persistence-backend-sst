import { describe, expect, it } from "vitest";
import {
  assignmentStatus,
  calorieLine,
  daysAgo,
  editorValues,
  emptyPlanValues,
  foodItem,
  kcalText,
  loggedThisWeek,
  macroLine,
  mealTotals,
  newMeal,
  planDetailLine,
  planSubline,
  planTotals,
  planVsTarget,
  portionText,
  recipeItem,
  recipePortion,
  recipeSubline,
  samePlan,
  savedMealItem,
  sentWords,
  servingText,
  stepPortion,
  targetSetBy,
  toPlanInput,
} from "../lib/mealPlans";
import {
  noteResolver,
  planEditorResolver,
  PLAN_NAME_MESSAGE,
  MEAL_NAME_MESSAGE,
  NOTE_MESSAGE,
  PORTION_MESSAGE,
} from "../lib/planForm";
import {
  CLIENT_MEAL_PLANS,
  FOODS,
  RECIPES,
  SAVED_MEALS,
  assignment,
  libraryPlan,
} from "./mealPlanFixtures";

const NOW = new Date("2026-11-26T12:00:00").getTime();
const TARGET = { dailyKcal: 2500, proteinG: 180, carbsG: 300, fatG: 70 };

describe("meal plan copy", () => {
  it("formats calories and macros as the boards do", () => {
    expect(kcalText(2476.4)).toBe("2,476");
    expect(
      macroLine({ kcal: 0, proteinG: 186.2, carbsG: 294, fatG: 62.6 }),
    ).toBe("186P 294C 63F");
    const plan = libraryPlan();
    expect(planSubline(plan)).toBe("2 meals · 186P 294C 63F");
    expect(planDetailLine({ ...plan, meals: [plan.meals[0]!] })).toBe(
      "1 meal · 2,476 kcal · 186P 294C 63F",
    );
  });

  it("says how long ago a plan was sent", () => {
    expect(daysAgo("2026-11-26T08:00:00", NOW)).toBe("today");
    expect(daysAgo("2026-11-27T08:00:00", NOW)).toBe("today");
    expect(daysAgo("2026-11-25T23:00:00", NOW)).toBe("yesterday");
    expect(daysAgo("2026-11-24T08:00:00", NOW)).toBe("2 days ago");
    expect(daysAgo("2026-10-21T08:00:00", NOW)).toBe("21 Oct");
    expect(sentWords("2026-11-24T08:00:00", NOW)).toBe("Sent 2 days ago");
  });

  it("shows what the client did with each plan", () => {
    expect(assignmentStatus(assignment(), "Sam", NOW)).toEqual({
      text: "In Sam’s plans · used 9 days",
      tone: "ok",
    });
    expect(assignmentStatus(assignment({ usedDays: 1 }), "Sam", NOW).text).toBe(
      "In Sam’s plans · used 1 day",
    );
    expect(assignmentStatus(assignment({ usedDays: 0 }), "Sam", NOW).text).toBe(
      "In Sam’s plans",
    );
    expect(
      assignmentStatus(assignment({ status: "dismissed" }), "Sam", NOW),
    ).toEqual({ text: "Sam chose Not now", tone: "idle" });
    expect(
      assignmentStatus(
        assignment({
          status: "sent",
          seenRevision: 3,
          sentAt: "2026-11-24T09:00:00",
        }),
        "Sam",
        NOW,
      ),
    ).toEqual({ text: "Sent 2 days ago", tone: "warn" });
    expect(
      assignmentStatus(
        assignment({
          status: "sent",
          seenRevision: 2,
          sentAt: "2026-11-26T09:00:00",
        }),
        "Sam",
        NOW,
      ).text,
    ).toBe("Sent today");
  });

  it("sums plan meals logged this week and words calorie adherence", () => {
    expect(loggedThisWeek(CLIENT_MEAL_PLANS.assignments)).toBe(19);
    expect(
      calorieLine({ daysOnTarget: 5, daysCounted: 7, daysNotLogged: 1 }),
    ).toBe("5 of 7 days on target · 1 not logged");
    expect(
      calorieLine({ daysOnTarget: 1, daysCounted: 1, daysNotLogged: 0 }),
    ).toBe("1 of 1 day on target");
    expect(
      calorieLine({ daysOnTarget: 0, daysCounted: 0, daysNotLogged: 0 }),
    ).toBeNull();
  });

  it("says who set the target", () => {
    expect(targetSetBy("coach-1", "coach-1", "c", "Sam")).toBe("Set by you");
    expect(targetSetBy(null, "coach-1", "c", "Sam")).toBe("Sam’s own target");
    expect(targetSetBy("c", "coach-1", "c", "Sam")).toBe("Sam’s own target");
    expect(targetSetBy("coach-2", "coach-1", "c", "Sam")).toBe(
      "Set by another coach",
    );
  });

  it("describes recipes", () => {
    expect(recipeSubline(RECIPES[0]!)).toBe("Recipe · 4 portions");
    expect(recipeSubline({ ...RECIPES[1]!, servings: 1 })).toBe(
      "Imported from a link · 1 portion",
    );
    expect(recipePortion(RECIPES[0]!).kcal).toBe(612);
    expect(
      recipePortion({ ...RECIPES[0]!, servings: 0, totalKcal: null }).kcal,
    ).toBe(0);
  });
});

describe("the editor model", () => {
  it("reads a saved plan: per-serving macros from each source", () => {
    const v = editorValues(libraryPlan());
    expect(v.name).toBe("Lean bulk · Training day");
    expect(v.meals.map((m) => m.name)).toEqual(["Breakfast", "Meal 4"]);
    const [oats, bowl] = v.meals[0]!.items;
    expect(oats!.source).toEqual({ kind: "food", foodId: "food-oats" });
    expect(oats!.serving).toBe("80 g");
    expect(bowl!.source).toEqual({ kind: "recipe", recipeId: "rec-bowl" });
    expect(bowl!.serving).toBe("1 portion");
    expect(bowl!.perServing.kcal).toBe(612);
    // A source that's gone: macros divided back to one serving, kept as a one-off.
    const gone = v.meals[1]!.items[0]!;
    expect(gone.source).toEqual({ kind: "custom" });
    expect(gone.serving).toBe("1 serving");
    expect(gone.perServing.kcal).toBe(640);
    expect(mealTotals(v.meals[1]!).kcal).toBe(1280);
    expect(planTotals(v).kcal).toBe(300 + 918 + 1280);
  });

  it("reads a saved meal, a one-off and a deleted item with no servings", () => {
    const plan = libraryPlan();
    const meal = plan.meals[0]!;
    const items = [
      {
        ...meal.items[0]!,
        id: "i-meal",
        kind: "meal" as const,
        foodId: null,
        mealId: "meal-yog",
        food: null,
        meal: {
          name: "Yog",
          photoUrl: null,
          perServing: { kcal: 214, proteinG: 18, carbsG: 24, fatG: 5 },
        },
      },
      {
        ...meal.items[0]!,
        id: "i-custom",
        kind: "custom" as const,
        foodId: null,
        food: null,
        custom: { name: "Shake", kcal: 150, proteinG: 25, carbsG: 5, fatG: 2 },
      },
      {
        ...meal.items[0]!,
        id: "i-zero",
        kind: "food" as const,
        foodId: null,
        food: null,
        servings: 0,
        kcal: 90,
      },
    ];
    const v = editorValues({ ...plan, meals: [{ ...meal, items }] });
    const [m, c, z] = v.meals[0]!.items;
    expect(m!.source).toEqual({ kind: "meal", mealId: "meal-yog" });
    expect(m!.perServing.kcal).toBe(214);
    expect(c!.source).toEqual({ kind: "custom" });
    expect(c!.perServing.kcal).toBe(150);
    expect(z!.source).toEqual({ kind: "custom" });
    expect(z!.perServing.kcal).toBe(90);
  });

  it("writes the API body for every kind of item", () => {
    const v = editorValues(libraryPlan());
    v.name = "  Lean bulk  ";
    v.meals[0]!.name = " Breakfast ";
    v.meals[0]!.items.push(savedMealItem(SAVED_MEALS[0]!));
    const body = toPlanInput(v);
    expect(body.name).toBe("Lean bulk");
    expect(body.meals[0]).toEqual({
      name: "Breakfast",
      logSlot: "breakfast",
      sortOrder: 0,
      items: [
        { servings: 1, sortOrder: 0, foodId: "food-oats" },
        { servings: 1.5, sortOrder: 1, recipeId: "rec-bowl" },
        { servings: 1, sortOrder: 2, mealId: "meal-yog" },
      ],
    });
    expect(body.meals[1]!.items[0]).toEqual({
      servings: 2,
      sortOrder: 0,
      custom: {
        name: "Salmon, potatoes and green beans",
        kcal: 640,
        proteinG: 38,
        carbsG: 49,
        fatG: 33,
      },
    });
    expect(samePlan(v, editorValues(libraryPlan()))).toBe(false);
    expect(
      samePlan(editorValues(libraryPlan()), editorValues(libraryPlan())),
    ).toBe(true);
  });

  it("builds items from foods, recipes and saved meals", () => {
    const f = foodItem(FOODS[0]!);
    expect(f.source).toEqual({ kind: "food", foodId: "food-salmon" });
    expect(f.serving).toBe("100 g");
    expect(recipeItem(RECIPES[0]!).perServing.kcal).toBe(612);
    expect(savedMealItem(SAVED_MEALS[0]!).serving).toBe("1 serving");
    expect(f.key).not.toBe(foodItem(FOODS[0]!).key);
  });

  it("steps portions by a quarter between the limits", () => {
    expect(stepPortion(1, 1)).toBe(1.25);
    expect(stepPortion(0.25, -1)).toBe(0.25);
    expect(stepPortion(100, 1)).toBe(100);
    // A phone-built portion under the quarter step isn't pushed up.
    expect(stepPortion(0.1, -1)).toBe(0.1);
    expect(stepPortion(0.1, 1)).toBe(0.35);
    expect(portionText(1.25)).toBe("×1.25");
    const item = foodItem(FOODS[0]!);
    expect(servingText(item)).toBe("100 g");
    expect(servingText({ ...item, servings: 1.5 })).toBe("100 g × 1.5");
  });

  it("new meals are numbered and cycle the old slots", () => {
    const start = emptyPlanValues();
    expect(start.meals).toHaveLength(1);
    expect(start.meals[0]!.name).toBe("Meal 1");
    const meals = [...start.meals];
    for (let i = 0; i < 4; i += 1) meals.push(newMeal(meals));
    expect(meals.map((m) => m.logSlot)).toEqual([
      "breakfast",
      "lunch",
      "dinner",
      "snack",
      "breakfast",
    ]);
    expect(meals[4]!.name).toBe("Meal 5");
  });
});

describe("the wheel and the strip", () => {
  const planned = (kcal: number) => ({
    kcal,
    proteinG: 186,
    carbsG: 294,
    fatG: 63,
  });

  it("on target within 100 kcal", () => {
    const v = planVsTarget(planned(2476), TARGET);
    expect(v.centre).toBe("2,476");
    expect(v.centreLabel).toBe("of 2,500");
    expect(v.centreTone).toBe("ok");
    expect(v.left).toBe("On target");
    expect(v.leftLabel).toBe("Within 100");
    expect(v.segments).toHaveLength(3);
    expect(v.macros.map((m) => [m.label, m.planned, m.target])).toEqual([
      ["Protein", 186, 180],
      ["Carbs", 294, 300],
      ["Fat", 63, 70],
    ]);
    expect(v.macros[0]!.pct).toBe(100);
    expect(v.ringLabel).toContain("2,476 of 2,500 kcal planned.");
  });

  it("under and over the target", () => {
    const under = planVsTarget(planned(2000), TARGET);
    expect([under.centre, under.centreLabel, under.centreTone]).toEqual([
      "500",
      "To plan",
      "under",
    ]);
    expect([under.left, under.leftLabel]).toEqual(["500", "To plan"]);
    const over = planVsTarget(planned(2800), TARGET);
    expect([over.centre, over.centreLabel, over.centreTone]).toEqual([
      "+300",
      "Over",
      "over",
    ]);
    expect([over.left, over.leftLabel]).toEqual(["+300", "Over"]);
  });

  it("with no target shows what's planned", () => {
    const v = planVsTarget(planned(2476), null);
    expect([v.centre, v.centreLabel, v.left, v.leftLabel]).toEqual([
      "2,476",
      "Planned",
      "—",
      "No target",
    ]);
    expect(v.macros[0]!.target).toBeNull();
    expect(v.macros[0]!.pct).toBe(0);
    const empty = planVsTarget(
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      null,
    );
    expect(empty.segments.every((s) => s.length === 0)).toBe(true);
  });
});

describe("plan forms", () => {
  const ctx = {} as never;
  const opts = { fields: {}, shouldUseNativeValidation: false } as never;

  it("refuses an empty name and a long meal name, on trimmed text", async () => {
    const v = editorValues(libraryPlan());
    v.name = "   ";
    v.meals[0]!.name = "x".repeat(41);
    const r = await planEditorResolver(v, ctx, opts);
    expect((r.errors.name as { message: string }).message).toBe(
      PLAN_NAME_MESSAGE,
    );
    expect(
      (r.errors.meals as unknown as { name: { message: string } }[])[0]!.name
        .message,
    ).toBe(MEAL_NAME_MESSAGE);
    const ok = await planEditorResolver(editorValues(libraryPlan()), ctx, opts);
    expect(ok.errors).toEqual({});
  });

  it("portions follow the server: more than 0, up to 100 (#577 review)", async () => {
    const at = (servings: number) => {
      const v = editorValues(libraryPlan());
      v.meals[0]!.items[0]!.servings = servings;
      return planEditorResolver(v, ctx, opts);
    };
    expect((await at(0.1)).errors).toEqual({});
    expect((await at(100)).errors).toEqual({});
    for (const bad of [0, 100.5]) {
      const r = await at(bad);
      const items = (
        r.errors.meals as unknown as {
          items: { servings: { message: string } }[];
        }[]
      )[0]!.items;
      expect(items[0]!.servings.message).toBe(PORTION_MESSAGE);
    }
  });

  it("a note is optional and up to 500 characters", async () => {
    expect((await noteResolver({ note: "" }, ctx, opts)).errors).toEqual({});
    const long = await noteResolver({ note: "x".repeat(501) }, ctx, opts);
    expect((long.errors.note as { message: string }).message).toBe(
      NOTE_MESSAGE,
    );
  });
});
