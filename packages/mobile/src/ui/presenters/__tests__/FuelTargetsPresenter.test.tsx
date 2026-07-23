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
    calorieMode: "calculated",
    onCalorieModeChange: jest.fn(),
    manualKcalText: "",
    onManualKcalTextChange: jest.fn(),
    tdee: 2480,
    kcal: 2480,
    goalLabelInfo: { name: "Maintain", sub: "Hold weight", tone: "success" },
    macroSplit: { proteinPct: 30, carbsPct: 45, fatPct: 25 },
    macroGrams: { proteinG: 186, carbsG: 279, fatG: 69 },
    activityId: "moderate",
    onActivityChange: jest.fn(),
    goal: 0,
    onGoalChange: jest.fn(),
    macroMode: "recommended",
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

  it("renders the profile-strip height/weight in cm/kg by default", () => {
    const { getByText } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps()} />,
    );
    expect(getByText("178")).toBeTruthy();
    expect(getByText("cm")).toBeTruthy();
    expect(getByText("79.8")).toBeTruthy();
    expect(getByText("kg")).toBeTruthy();
  });

  it("converts the profile-strip weight to lb when weightUnit is lb", () => {
    const { getByText, queryByText } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ weightUnit: "lb" })} />,
    );
    // 79.8 kg -> 175.9 lb (weightInUnit, 1dp).
    expect(getByText("175.9")).toBeTruthy();
    expect(getByText("lb")).toBeTruthy();
    expect(queryByText("79.8")).toBeNull();
  });

  it("renders the profile-strip height as feet'inches with no separate unit when heightUnit is ftin", () => {
    const { getByText, queryByText } = renderWithTheme(
      <FuelTargetsPresenter {...makeProps({ heightUnit: "ftin" })} />,
    );
    // 178 cm -> 5'10" (formatHeight).
    expect(getByText(`5'10"`)).toBeTruthy();
    expect(queryByText("178")).toBeNull();
    expect(queryByText("cm")).toBeNull();
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
    ["recommended", "recommended"],
    ["high_protein", "high_protein"],
    ["balanced", "balanced"],
    ["low_carb", "low_carb"],
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
      <FuelTargetsPresenter {...makeProps({ macroMode: "recommended" })} />,
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

  it("shows the water goal in litres by default (device-QA #5/#7 — metric default) + increments/decrements within bounds", () => {
    const onWaterCupsChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter
        {...makeProps({ waterCups: 8, onWaterCupsChange })}
      />,
    );
    // 8 cups × 0.25 = 2.0 L — the stepper still steps by 1 CUP underneath.
    expect(getByTestId("fuel-targets-water-cups").props.children).toBe("2.0 L");
    fireEvent.press(getByTestId("fuel-targets-water-plus"));
    expect(onWaterCupsChange).toHaveBeenCalledWith(9);
    fireEvent.press(getByTestId("fuel-targets-water-minus"));
    expect(onWaterCupsChange).toHaveBeenCalledWith(7);
  });

  it("volumeUnit=cups shows the raw cup count (imperial, matching pre-fix behaviour)", () => {
    const onWaterCupsChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter
        {...makeProps({
          waterCups: 8,
          onWaterCupsChange,
          volumeUnit: "cups",
        })}
      />,
    );
    expect(getByTestId("fuel-targets-water-cups").props.children).toBe(
      "8 cups",
    );
    fireEvent.press(getByTestId("fuel-targets-water-plus"));
    expect(onWaterCupsChange).toHaveBeenCalledWith(9);
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

  // ── Manual calorie mode ───────────────────────────────────────────────────

  it("fires onCalorieModeChange from the mode toggle", () => {
    const props = makeProps();
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...props} />,
    );
    fireEvent.press(getByTestId("fuel-targets-calorie-mode-manual"));
    expect(props.onCalorieModeChange).toHaveBeenCalledWith("manual");
  });

  it("manual mode swaps the calculator sections for the kcal input (macros/water stay)", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <FuelTargetsPresenter
        {...makeProps({
          calorieMode: "manual",
          manualKcalText: "2200",
          tdee: null,
          kcal: 2200,
        })}
      />,
    );
    expect(getByTestId("fuel-targets-manual-kcal-input").props.value).toBe(
      "2200",
    );
    // Calculator-only sections are hidden…
    expect(queryByTestId("fuel-targets-open-profile")).toBeNull();
    expect(queryByTestId("fuel-targets-activity-moderate")).toBeNull();
    expect(queryByTestId("fuel-targets-goal-slider")).toBeNull();
    // …the macro editor, water goal and MANUAL pill remain.
    expect(getByTestId("fuel-targets-macro-sliders")).toBeTruthy();
    expect(getByTestId("fuel-targets-manual-pill")).toBeTruthy();
  });

  it("manual mode still allows changing the macro split preset", () => {
    const props = makeProps({
      calorieMode: "manual",
      manualKcalText: "2200",
      tdee: null,
      kcal: 2200,
    });
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...props} />,
    );
    fireEvent.press(getByTestId("fuel-targets-macro-mode-high_protein"));
    expect(props.onMacroModeChange).toHaveBeenCalledWith("high_protein");
  });

  it("forwards typed kcal text and shows the range warning when out of range", () => {
    const props = makeProps({
      calorieMode: "manual",
      manualKcalText: "99",
      tdee: null,
      kcal: null, // container's preview nulls an out-of-range kcal
    });
    const { getByTestId } = renderWithTheme(
      <FuelTargetsPresenter {...props} />,
    );
    fireEvent.changeText(getByTestId("fuel-targets-manual-kcal-input"), "990");
    expect(props.onManualKcalTextChange).toHaveBeenCalledWith("990");
    expect(getByTestId("fuel-targets-manual-kcal-warning")).toBeTruthy();
    // kcal === null also disables Save (same contract as incomplete profile).
    expect(
      getByTestId("fuel-targets-save").props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("hides the range warning while the field is simply empty", () => {
    const { queryByTestId } = renderWithTheme(
      <FuelTargetsPresenter
        {...makeProps({
          calorieMode: "manual",
          manualKcalText: "",
          tdee: null,
          kcal: null,
        })}
      />,
    );
    expect(queryByTestId("fuel-targets-manual-kcal-warning")).toBeNull();
  });
});
