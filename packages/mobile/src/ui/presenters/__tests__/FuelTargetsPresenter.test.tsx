import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  FuelTargetsPresenter,
  type FuelTargetsPresenterProps,
} from "../FuelTargetsPresenter";

/**
 * LinearSlider is gesture-driven — react-native-gesture-handler is globally
 * mocked as a no-op passthrough (`__tests__/setup.ts`), so drag/tap can't be
 * simulated. This LOCAL mock renders a `TextInput` proxy per slider instance
 * (`{testID}-input`) so tests can drive `onValueChange` with an arbitrary
 * number via `fireEvent.changeText`, while still forwarding `disabled` onto
 * `editable` so the macro sliders' locked-until-Custom behaviour is
 * assertable. LinearSlider's own math/rendering are covered directly in its
 * `__tests__/` (not mocked there).
 */
jest.mock("@/ui/components/foundation/LinearSlider", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextInput, View } = require("react-native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    __esModule: true,
    LinearSlider: ({
      value,
      onValueChange,
      disabled,
      testID,
    }: {
      value: number;
      onValueChange: (v: number) => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      React.createElement(
        View,
        { testID },
        React.createElement(TextInput, {
          testID: `${testID}-input`,
          editable: !disabled,
          value: String(value),
          onChangeText: (t: string) => onValueChange(Number(t)),
        }),
      ),
  };
});

function makeProps(
  overrides: Partial<FuelTargetsPresenterProps> = {},
): FuelTargetsPresenterProps {
  return {
    isLoadingInitial: false,
    isSaving: false,
    errorMessage: null,
    onCancel: jest.fn(),
    onSave: jest.fn(),
    trainerName: null,
    age: 28,
    gender: "male",
    heightCm: 178,
    weightKg: 79.8,
    onOpenProfile: jest.fn(),
    tdee: 2480,
    kcal: 2480,
    goalLabelInfo: { name: "Maintain", sub: "Hold weight", tone: "success" },
    macroSplit: { proteinPct: 30, carbsPct: 45, fatPct: 25 },
    macroGrams: { proteinG: 186, carbsG: 279, fatG: 69 },
    activityId: "moderate",
    onActivityChange: jest.fn(),
    goal: 0,
    onGoalChange: jest.fn(),
    macroMode: "maintain",
    onMacroModeChange: jest.fn(),
    onProteinPctChange: jest.fn(),
    onCarbsPctChange: jest.fn(),
    onFatPctChange: jest.fn(),
    waterCups: 8,
    onWaterCupsChange: jest.fn(),
    ...overrides,
  };
}

describe("FuelTargetsPresenter", () => {
  it("renders the loader when isLoadingInitial, hiding the form", () => {
    const { queryByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ isLoadingInitial: true })} />,
    );
    expect(queryByTestId("fuel-targets-screen")).toBeTruthy();
    expect(queryByTestId("fuel-targets-save")).toBeNull();
  });

  it("shows the kcal target formatted", () => {
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ kcal: 2480 })} />,
    );
    expect(getByTestId("fuel-targets-kcal").props.children).toBe("2,480");
  });

  it("shows an em dash for kcal when the profile is incomplete", () => {
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ kcal: null, macroGrams: null })} />,
    );
    expect(getByTestId("fuel-targets-kcal").props.children).toBe("—");
  });

  it("fires onCancel when Cancel is pressed", () => {
    const onCancel = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ onCancel })} />,
    );
    fireEvent.press(getByTestId("fuel-targets-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("fires onSave when Save is pressed with a valid split", () => {
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ onSave })} />,
    );
    fireEvent.press(getByTestId("fuel-targets-save"));
    expect(onSave).toHaveBeenCalled();
  });

  it("disables Save while saving", () => {
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ isSaving: true, onSave })} />,
    );
    fireEvent.press(getByTestId("fuel-targets-save"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("disables Save and shows a warning chip when the macro split doesn't sum to 100", () => {
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter
        {...makeProps({
          macroSplit: { proteinPct: 50, carbsPct: 50, fatPct: 30 },
          onSave,
        })}
      />,
    );
    expect(getByTestId("fuel-targets-split-warning")).toBeTruthy();
    fireEvent.press(getByTestId("fuel-targets-save"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("disables Save when the profile is incomplete, even with a valid default split", () => {
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter
        {...makeProps({ kcal: null, macroGrams: null, onSave })}
      />,
    );
    fireEvent.press(getByTestId("fuel-targets-save"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("hides the warning chip when the split sums to 100", () => {
    const { queryByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps()} />,
    );
    expect(queryByTestId("fuel-targets-split-warning")).toBeNull();
  });

  it("shows the trainer-attribution banner only when a trainer set the target", () => {
    const { queryByTestId, getByText } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ trainerName: "Coach Bradley" })} />,
    );
    expect(queryByTestId("fuel-targets-trainer-banner")).toBeTruthy();
    expect(getByText("Coach Bradley")).toBeTruthy();
  });

  it("hides the trainer banner when no trainer set the target", () => {
    const { queryByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ trainerName: null })} />,
    );
    expect(queryByTestId("fuel-targets-trainer-banner")).toBeNull();
  });

  it("shows em dashes for unset profile fields and routes to Edit Profile on tap", () => {
    const onOpenProfile = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter
        {...makeProps({
          age: null,
          gender: null,
          heightCm: null,
          weightKg: null,
          onOpenProfile,
        })}
      />,
    );
    fireEvent.press(getByTestId("fuel-targets-open-profile"));
    expect(onOpenProfile).toHaveBeenCalled();
  });

  it("fires onActivityChange with the tapped chip's id", () => {
    const onActivityChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ onActivityChange })} />,
    );
    fireEvent.press(getByTestId("fuel-targets-activity-athlete"));
    expect(onActivityChange).toHaveBeenCalledWith("athlete");
  });

  it("fires onGoalChange when the goal slider value changes", () => {
    const onGoalChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ onGoalChange })} />,
    );
    fireEvent.changeText(getByTestId("fuel-targets-goal-slider-input"), "0.5");
    expect(onGoalChange).toHaveBeenCalledWith(0.5);
  });

  it.each([
    ["maintain", "maintain"],
    ["cut", "cut"],
    ["bulk", "bulk"],
    ["custom", "custom"],
  ])("fires onMacroModeChange(%s) when that preset chip is tapped", (id) => {
    const onMacroModeChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ onMacroModeChange })} />,
    );
    fireEvent.press(getByTestId(`fuel-targets-macro-mode-${id}`));
    expect(onMacroModeChange).toHaveBeenCalledWith(id);
  });

  it("disables the macro sliders when mode is not 'custom'", () => {
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ macroMode: "maintain" })} />,
    );
    expect(
      getByTestId("fuel-targets-protein-slider-input").props.editable,
    ).toBe(false);
  });

  it("enables the macro sliders in 'custom' mode and fires the per-macro handlers", () => {
    const onProteinPctChange = jest.fn();
    const onCarbsPctChange = jest.fn();
    const onFatPctChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter
        {...makeProps({
          macroMode: "custom",
          onProteinPctChange,
          onCarbsPctChange,
          onFatPctChange,
        })}
      />,
    );
    expect(
      getByTestId("fuel-targets-protein-slider-input").props.editable,
    ).toBe(true);
    fireEvent.changeText(
      getByTestId("fuel-targets-protein-slider-input"),
      "40",
    );
    fireEvent.changeText(getByTestId("fuel-targets-carbs-slider-input"), "35");
    fireEvent.changeText(getByTestId("fuel-targets-fat-slider-input"), "25");
    expect(onProteinPctChange).toHaveBeenCalledWith(40);
    expect(onCarbsPctChange).toHaveBeenCalledWith(35);
    expect(onFatPctChange).toHaveBeenCalledWith(25);
  });

  it("shows the water goal + increments/decrements within bounds", () => {
    const onWaterCupsChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter
        {...makeProps({ waterCups: 8, onWaterCupsChange })}
      />,
    );
    expect(getByTestId("fuel-targets-water-cups").props.children).toEqual([
      8,
      " cups",
    ]);
    fireEvent.press(getByTestId("fuel-targets-water-plus"));
    expect(onWaterCupsChange).toHaveBeenCalledWith(9);
    fireEvent.press(getByTestId("fuel-targets-water-minus"));
    expect(onWaterCupsChange).toHaveBeenCalledWith(7);
  });

  it("clamps the water goal at the minimum (1 cup)", () => {
    const onWaterCupsChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter
        {...makeProps({ waterCups: 1, onWaterCupsChange })}
      />,
    );
    expect(
      getByTestId("fuel-targets-water-minus").props.accessibilityState
        ?.disabled,
    ).toBe(true);
  });

  it("clamps the water goal at the maximum (20 cups)", () => {
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ waterCups: 20 })} />,
    );
    expect(
      getByTestId("fuel-targets-water-plus").props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("shows the error banner when errorMessage is set", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <FuelTargetsPresenter
        {...makeProps({ errorMessage: "Couldn't save your targets." })}
      />,
    );
    expect(getByTestId("fuel-targets-error")).toBeTruthy();
    expect(getByText("Couldn't save your targets.")).toBeTruthy();
  });
});
