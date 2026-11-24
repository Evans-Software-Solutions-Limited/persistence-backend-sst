import type { Food } from "@/domain/models/nutrition";
import { PLAN_ITEMS_PER_MEAL_MAX } from "@/domain/models/nutritionPlans";
import {
  emptyPlanMeal,
  newDraftPlan,
  planItemFromFood,
} from "@/domain/services/nutritionPlans.service";
import { usePlanDraft } from "../plan-draft";

const food: Food = {
  id: "f1",
  name: "Large egg",
  brand: null,
  barcode: null,
  kcal: 72,
  proteinG: 6,
  carbsG: 0,
  fatG: 5,
  servingSize: 1,
  servingUnit: "egg",
  servingQuantity: null,
  source: "user",
  createdBy: null,
};

const plan = () =>
  newDraftPlan({
    id: "local-p",
    ownerId: "u",
    name: "Rest day",
    meals: [
      emptyPlanMeal("m1", "Breakfast", "breakfast", 0),
      emptyPlanMeal("m2", "Lunch", "lunch", 1),
    ],
    now: "2026-11-23T00:00:00.000Z",
  });

describe("usePlanDraft", () => {
  beforeEach(() => usePlanDraft.getState().clear());

  it("ignores edits before a draft starts", () => {
    usePlanDraft.getState().rename("x");
    expect(usePlanDraft.getState().draft).toBeNull();
  });

  it("starts, renames and adds items with totals recomputed", () => {
    const s = usePlanDraft.getState();
    s.start("new", plan());
    expect(usePlanDraft.getState().mode).toBe("new");
    s.rename("Training day");
    s.addItems("m1", [
      planItemFromFood("i1", food, 2),
      planItemFromFood("i2", food, 1),
    ]);
    const d = usePlanDraft.getState().draft!;
    expect(d.name).toBe("Training day");
    expect(d.meals[0].items.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(d.meals[0].totals.kcal).toBe(216);
    expect(d.totals.kcal).toBe(216);
  });

  it("replaces, moves and removes items", () => {
    const s = usePlanDraft.getState();
    s.start("edit", plan());
    s.addItems("m1", [planItemFromFood("i1", food, 1)]);
    s.replaceItem("m1", planItemFromFood("i1", food, 3));
    expect(usePlanDraft.getState().draft!.totals.kcal).toBe(216);
    s.moveItem("m1", "m1", planItemFromFood("i1", food, 2));
    expect(usePlanDraft.getState().draft!.meals[0].items[0].servings).toBe(2);
    s.moveItem("m1", "m2", planItemFromFood("i1", food, 1));
    let d = usePlanDraft.getState().draft!;
    expect(d.meals[0].items).toHaveLength(0);
    expect(d.meals[1].items[0].id).toBe("i1");
    s.removeItem("m2", "i1");
    d = usePlanDraft.getState().draft!;
    expect(d.totals.kcal).toBe(0);
  });

  it("setDraft replaces the plan and clear empties it", () => {
    const s = usePlanDraft.getState();
    s.start("new", plan());
    s.setDraft({ ...plan(), name: "Other" });
    expect(usePlanDraft.getState().draft!.name).toBe("Other");
    s.clear();
    expect(usePlanDraft.getState()).toMatchObject({ mode: null, draft: null });
  });

  it("moving an item into a full meal keeps it where it was", () => {
    // Inspector Brad, #554: the server takes 50 items a meal.
    const s = usePlanDraft.getState();
    s.start("new", plan());
    s.addItems(
      "m2",
      Array.from({ length: PLAN_ITEMS_PER_MEAL_MAX }, (_, i) =>
        planItemFromFood(`f${i}`, food, 1),
      ),
    );
    s.addItems("m1", [planItemFromFood("mover", food, 1)]);
    const mover = usePlanDraft.getState().draft!.meals[0].items[0];
    s.moveItem("m1", "m2", { ...mover, servings: 2 });
    const d = usePlanDraft.getState().draft!;
    expect(d.meals[0].items.map((i) => i.id)).toEqual(["mover"]);
    expect(d.meals[0].items[0].servings).toBe(2);
    expect(d.meals[1].items).toHaveLength(PLAN_ITEMS_PER_MEAL_MAX);
  });
});
