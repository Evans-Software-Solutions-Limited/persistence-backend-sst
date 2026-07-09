import { useGoalSheet } from "@/state/goal-sheet";

describe("useGoalSheet", () => {
  beforeEach(() => {
    useGoalSheet.getState().closeSheet();
  });

  it("openForCreate sets create mode with the taken types + onChanged", () => {
    const onChanged = jest.fn();
    useGoalSheet.getState().openForCreate(["gt-1", "gt-2"], onChanged);

    const s = useGoalSheet.getState();
    expect(s.open).toBe(true);
    expect(s.editGoal).toBeNull();
    expect(s.takenGoalTypeIds).toEqual(["gt-1", "gt-2"]);
    expect(s.onChanged).toBe(onChanged);
  });

  it("openForEdit sets edit mode with the target goal", () => {
    useGoalSheet.getState().openForEdit({
      goalId: "g-9",
      goalTypeName: "Squat 1RM",
      targetDate: "2026-12-31",
    });

    const s = useGoalSheet.getState();
    expect(s.open).toBe(true);
    expect(s.editGoal?.goalId).toBe("g-9");
    expect(s.takenGoalTypeIds).toEqual([]);
  });

  it("closeSheet clears everything", () => {
    useGoalSheet.getState().openForCreate(["gt-1"]);
    useGoalSheet.getState().closeSheet();

    const s = useGoalSheet.getState();
    expect(s.open).toBe(false);
    expect(s.editGoal).toBeNull();
    expect(s.takenGoalTypeIds).toEqual([]);
    expect(s.onChanged).toBeNull();
  });
});
