import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { HabitSetupPresenter } from "../HabitSetupPresenter";
import {
  HABIT_ORDER,
  defaultHabitConfig,
  type HabitCategory,
  type HabitConfig,
} from "@/domain/models/habit-config";

function allConfigs(): Record<HabitCategory, HabitConfig> {
  const map = {} as Record<HabitCategory, HabitConfig>;
  for (const c of HABIT_ORDER) map[c] = defaultHabitConfig(c);
  return map;
}

function render(over: Partial<Parameters<typeof HabitSetupPresenter>[0]> = {}) {
  const props = {
    configs: allConfigs(),
    streak: 0,
    longest: 0,
    freezeTokens: 0,
    atRisk: false,
    skipped: false,
    canSave: false,
    saving: false,
    onBack: jest.fn(),
    onToggle: jest.fn(),
    onTargetChange: jest.fn(),
    onFreqChange: jest.fn(),
    onLeniencyChange: jest.fn(),
    onSpendFreeze: jest.fn(),
    onAdjustNutrition: jest.fn(),
    onSave: jest.fn(),
    ...over,
  };
  return { props, ...renderWithTheme(<HabitSetupPresenter {...props} />) };
}

describe("HabitSetupPresenter", () => {
  it("renders the streak section, all five cards in order, and the footer", () => {
    const { getByTestId } = render();
    expect(getByTestId("habit-streak-section")).toBeTruthy();
    for (const c of ["water", "gym", "steps", "sleep", "calories"]) {
      expect(getByTestId(`habit-setup-card-${c}`)).toBeTruthy();
    }
    expect(getByTestId("habit-setup-footer")).toBeTruthy();
  });

  it("back button fires onBack", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("habit-setup-back"));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("toggling a card enables it via onToggle(category, true)", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("habit-setup-card-water-switch"));
    expect(props.onToggle).toHaveBeenCalledWith("water", true);
  });

  it("coach view: renders the attribution subtitle", () => {
    const { getByTestId } = render({
      coachSubtitle: "You're editing this client's habits",
    });
    expect(getByTestId("habit-setup-coach-subtitle")).toBeTruthy();
  });

  it("athlete view: no coach subtitle", () => {
    const { queryByTestId } = render();
    expect(queryByTestId("habit-setup-coach-subtitle")).toBeNull();
  });

  it("forwards target / freq / leniency edits with the right category", () => {
    const configs = allConfigs();
    configs.water = { ...configs.water, enabled: true, goalId: "g-water" };
    configs.calories = { ...configs.calories, enabled: true, goalId: "g-cals" };
    const { getByTestId, props } = render({ configs });

    fireEvent.press(getByTestId("habit-setup-card-water-target-inc"));
    expect(props.onTargetChange).toHaveBeenCalledWith("water", 2.1);

    fireEvent.press(getByTestId("habit-setup-card-water-freq-pip-3"));
    expect(props.onFreqChange).toHaveBeenCalledWith("water", 3);

    fireEvent.press(getByTestId("habit-setup-card-calories-leniency-inc"));
    expect(props.onLeniencyChange).toHaveBeenCalledWith("calories", 15);
  });

  it("spend-freeze flows through to onSpendFreeze", () => {
    const { getByTestId, props } = render({ freezeTokens: 2 });
    fireEvent.press(getByTestId("habit-streak-section-freeze-cta"));
    expect(props.onSpendFreeze).toHaveBeenCalled();
  });

  it("Save button: disabled when !canSave, fires onSave when enabled", () => {
    const disabled = render({ canSave: false });
    fireEvent.press(disabled.getByTestId("habit-setup-save"));
    expect(disabled.props.onSave).not.toHaveBeenCalled();

    const enabled = render({ canSave: true });
    fireEvent.press(enabled.getByTestId("habit-setup-save"));
    expect(enabled.props.onSave).toHaveBeenCalled();
  });

  it("Save button shows 'Saving…' while a save is in flight", () => {
    const { getByText } = render({ canSave: false, saving: true });
    expect(getByText("Saving…")).toBeTruthy();
  });
});
