import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { HabitCardPresenter } from "../HabitCardPresenter";
import {
  defaultHabitConfig,
  type HabitConfig,
} from "@/domain/models/habit-config";

function render(
  config: HabitConfig,
  over: Partial<Parameters<typeof HabitCardPresenter>[0]> = {},
) {
  const props = {
    config,
    onToggle: jest.fn(),
    onTargetChange: jest.fn(),
    onFreqChange: jest.fn(),
    onLeniencyChange: jest.fn(),
    onAdjustNutrition: jest.fn(),
    testID: "card",
    ...over,
  };
  return { props, ...renderWithTheme(<HabitCardPresenter {...props} />) };
}

const enabledWater = (): HabitConfig => ({
  ...defaultHabitConfig("water"),
  enabled: true,
  goalId: "g-water",
});

describe("HabitCardPresenter", () => {
  it("disabled: collapses to the header (no controls)", () => {
    const { queryByTestId } = render(defaultHabitConfig("water"));
    expect(queryByTestId("card-target")).toBeNull();
    expect(queryByTestId("card-freq")).toBeNull();
  });

  it("enabled water: shows target Stepper + days/week WeekFreq", () => {
    const { getByTestId } = render(enabledWater());
    expect(getByTestId("card-target")).toBeTruthy();
    expect(getByTestId("card-freq")).toBeTruthy();
  });

  it("target stepper +/- clamps and calls onTargetChange", () => {
    const { getByTestId, props } = render(enabledWater());
    fireEvent.press(getByTestId("card-target-inc"));
    // 2 + 0.1 → 2.1
    expect(props.onTargetChange).toHaveBeenCalledWith(2.1);
  });

  it("gym: no days/week row (its target is the weekly count)", () => {
    const gym: HabitConfig = {
      ...defaultHabitConfig("gym"),
      enabled: true,
      goalId: "g-gym",
    };
    const { queryByTestId } = render(gym);
    expect(queryByTestId("card-freq")).toBeNull();
    expect(queryByTestId("card-target")).toBeTruthy();
  });

  it("calories: read-only gold deep-link (no stepper) + NUTRITION pill + leniency stepper", () => {
    const cals: HabitConfig = {
      ...defaultHabitConfig("calories"),
      enabled: true,
      goalId: "g-cals",
    };
    const { getByTestId, queryByTestId, props } = render(cals);
    expect(getByTestId("card-nutrition-link")).toBeTruthy();
    expect(queryByTestId("card-target")).toBeNull(); // no stepper for the goal
    expect(getByTestId("card-leniency")).toBeTruthy();
    fireEvent.press(getByTestId("card-nutrition-link"));
    expect(props.onAdjustNutrition).toHaveBeenCalled();
  });

  it("coach-locked: shows named attribution + disables the switch", () => {
    const locked: HabitConfig = {
      ...enabledWater(),
      assignedByCoach: true,
      assignedByName: "Bradley Evans",
      locked: true,
    };
    const { getByTestId, getByText, props } = render(locked);
    expect(getByTestId("card-attribution")).toBeTruthy();
    // The coach's real name is rendered (Phase 11), not a generic string.
    expect(getByText("Bradley Evans")).toBeTruthy();
    // The switch is disabled — pressing it does nothing.
    fireEvent.press(getByTestId("card-switch"));
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("coach-assigned without a resolved name: falls back to the generic line", () => {
    const assigned: HabitConfig = {
      ...enabledWater(),
      assignedByCoach: true,
      assignedByName: null,
      locked: true,
    };
    const { getByTestId, getByText } = render(assigned);
    expect(getByTestId("card-attribution")).toBeTruthy();
    expect(getByText("Set by your coach")).toBeTruthy();
  });

  it("self-set habit: no coach attribution", () => {
    const { queryByTestId } = render(enabledWater());
    expect(queryByTestId("card-attribution")).toBeNull();
  });

  it("coach-assigned but unlocked (relationship ended): attribution persists as history, controls enabled", () => {
    const transferred: HabitConfig = {
      ...enabledWater(),
      assignedByCoach: true,
      assignedByName: "Bradley Evans",
      locked: false,
    };
    const { getByTestId, getByText, props } = render(transferred);
    // Badge still attributes (§1.5 historical record)…
    expect(getByTestId("card-attribution")).toBeTruthy();
    expect(getByText("Bradley Evans")).toBeTruthy();
    // …but the client now owns the habit — the switch is live again.
    fireEvent.press(getByTestId("card-switch"));
    expect(props.onToggle).toHaveBeenCalled();
  });

  it("pending edit: shows the new value + a Starts Monday tag", () => {
    const pending: HabitConfig = {
      ...enabledWater(),
      targetValue: 2,
      pending: { from: "2026-06-15", targetValue: 3 },
    };
    const { getByTestId } = render(pending);
    // The displayed value is the PENDING one (3.0), and the tag renders.
    expect(getByTestId("card-target-value").props.children).toBe("3.0");
    expect(getByTestId("card-starts-monday")).toBeTruthy();
  });

  it("toggle off: fires onToggle(false)", () => {
    const { getByTestId, props } = render(enabledWater());
    fireEvent.press(getByTestId("card-switch"));
    expect(props.onToggle).toHaveBeenCalledWith(false);
  });

  it("target decrement clamps at min and fires onTargetChange", () => {
    const { getByTestId, props } = render(enabledWater());
    fireEvent.press(getByTestId("card-target-dec"));
    // 2 - 0.1 → 1.9
    expect(props.onTargetChange).toHaveBeenCalledWith(1.9);
  });

  it("days/week pip fires onFreqChange with the pip index", () => {
    const { getByTestId, props } = render(enabledWater());
    fireEvent.press(getByTestId("card-freq-pip-4"));
    expect(props.onFreqChange).toHaveBeenCalledWith(4);
  });

  it("leniency +/- fires onLeniencyChange (calories)", () => {
    const cals: HabitConfig = {
      ...defaultHabitConfig("calories"),
      enabled: true,
      goalId: "g-cals",
      tolerancePct: 10,
    };
    const { getByTestId, props } = render(cals);
    fireEvent.press(getByTestId("card-leniency-inc"));
    expect(props.onLeniencyChange).toHaveBeenCalledWith(15);
    fireEvent.press(getByTestId("card-leniency-dec"));
    expect(props.onLeniencyChange).toHaveBeenCalledWith(5);
  });

  it("pending days edit shows the Starts Monday tag on the freq row", () => {
    const cfg: HabitConfig = {
      ...enabledWater(),
      daysPerWeek: 5,
      pending: { from: "2026-06-15", daysPerWeek: 7 },
    };
    const { getByTestId } = render(cfg);
    expect(getByTestId("card-starts-monday")).toBeTruthy();
  });

  it("pending leniency edit shows the Starts Monday tag (calories)", () => {
    const cals: HabitConfig = {
      ...defaultHabitConfig("calories"),
      enabled: true,
      goalId: "g-cals",
      tolerancePct: 10,
      pending: { from: "2026-06-15", tolerancePct: 20 },
    };
    const { getByTestId } = render(cals);
    expect(getByTestId("card-starts-monday")).toBeTruthy();
  });

  it("coach-locked calories: nutrition link still navigates (deep-link is a read)", () => {
    const cals: HabitConfig = {
      ...defaultHabitConfig("calories"),
      enabled: true,
      goalId: "g-cals",
      locked: true,
      assignedByCoach: true,
    };
    const { getByTestId, props } = render(cals);
    fireEvent.press(getByTestId("card-nutrition-link"));
    expect(props.onAdjustNutrition).toHaveBeenCalled();
  });
});
