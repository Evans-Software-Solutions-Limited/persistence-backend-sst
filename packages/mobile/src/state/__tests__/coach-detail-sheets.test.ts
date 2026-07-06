import {
  initialFromCalorieHit,
  useEditNutritionTargetsSheet,
} from "@/state/edit-nutrition-targets-sheet";
import { useAssignGoalSheet } from "@/state/assign-goal-sheet";

describe("initialFromCalorieHit", () => {
  it("returns null when there is no calorie module", () => {
    expect(initialFromCalorieHit(null)).toBeNull();
  });

  it("maps the calorie target into the initial (macros blank)", () => {
    expect(
      initialFromCalorieHit({
        targetKcal: 2400,
        daysHit: 5,
        daysLogged: 7,
        todayKcal: 1800,
        todayRemainingKcal: 600,
      }),
    ).toEqual({
      dailyKcal: 2400,
      proteinG: null,
      carbsG: null,
      fatG: null,
      waterCups: null,
    });
  });
});

describe("useEditNutritionTargetsSheet store", () => {
  it("open/close toggles the client + initial + callback", () => {
    const onSaved = jest.fn();
    useEditNutritionTargetsSheet.getState().openSheet(
      "c-1",
      {
        dailyKcal: 2000,
        proteinG: null,
        carbsG: null,
        fatG: null,
        waterCups: null,
      },
      onSaved,
    );
    let s = useEditNutritionTargetsSheet.getState();
    expect(s.open).toBe(true);
    expect(s.clientId).toBe("c-1");
    expect(s.initial?.dailyKcal).toBe(2000);
    s.closeSheet();
    s = useEditNutritionTargetsSheet.getState();
    expect(s.open).toBe(false);
    expect(s.clientId).toBeNull();
    expect(s.initial).toBeNull();
  });

  it("defaults initial to null when none is supplied", () => {
    useEditNutritionTargetsSheet.getState().openSheet("c-2", null);
    expect(useEditNutritionTargetsSheet.getState().initial).toBeNull();
    useEditNutritionTargetsSheet.getState().closeSheet();
  });
});

describe("useAssignGoalSheet store", () => {
  it("openForCreate sets create mode (no editGoal)", () => {
    useAssignGoalSheet.getState().openForCreate("c-1");
    const s = useAssignGoalSheet.getState();
    expect(s.open).toBe(true);
    expect(s.clientId).toBe("c-1");
    expect(s.editGoal).toBeNull();
    s.closeSheet();
  });

  it("openForEdit sets edit mode with the target", () => {
    useAssignGoalSheet
      .getState()
      .openForEdit("c-1", { goalId: "g-1", title: "T", targetDate: null });
    const s = useAssignGoalSheet.getState();
    expect(s.open).toBe(true);
    expect(s.editGoal).toMatchObject({ goalId: "g-1", title: "T" });
    s.closeSheet();
    expect(useAssignGoalSheet.getState().editGoal).toBeNull();
  });
});
