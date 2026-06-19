import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { WeighInSheetPresenter } from "../WeighInSheetPresenter";

const TODAY = new Date("2026-06-10T12:00:00.000Z");

function render(overrides = {}) {
  const onSave = jest.fn();
  const onClose = jest.fn();
  const utils = renderWithTheme(
    <WeighInSheetPresenter
      visible
      onClose={onClose}
      onSave={onSave}
      history={[80.5, 80.2, 79.9, 79.8]}
      today={TODAY}
      {...overrides}
    />,
  );
  return { ...utils, onSave, onClose };
}

describe("WeighInSheetPresenter", () => {
  it("renders the weight input seeded from the latest history value", () => {
    const { getByTestId } = render();
    expect(getByTestId("weigh-in-sheet")).toBeTruthy();
    expect(getByTestId("weigh-in-input").props.value).toBe("79.8");
  });

  it("saves the canonical kg value + today by default", () => {
    const { getByText, onSave } = render();
    fireEvent.press(getByText(/Log 79.8 kg · Today/));
    expect(onSave).toHaveBeenCalledWith({
      weightKg: 79.8,
      bodyFatPercentage: null,
      day: "2026-06-10",
      unit: "kg",
    });
  });

  it("includes a typed body-fat percentage in the save payload", () => {
    const { getByTestId, getByText, onSave } = render();
    fireEvent.changeText(getByTestId("weigh-in-bodyfat-input"), "18.5");
    fireEvent.press(getByText(/Log 79.8 kg · Today/));
    expect(onSave).toHaveBeenCalledWith({
      weightKg: 79.8,
      bodyFatPercentage: 18.5,
      day: "2026-06-10",
      unit: "kg",
    });
  });

  it("clamps an out-of-range body-fat entry to 0..100", () => {
    const { getByTestId } = render();
    fireEvent.changeText(getByTestId("weigh-in-bodyfat-input"), "150");
    expect(getByTestId("weigh-in-bodyfat-input").props.value).toBe("100");
  });

  it("converts the displayed value when toggled to lb but stores kg", () => {
    const { getByLabelText, getByTestId } = render();
    fireEvent.press(getByLabelText("Use lb"));
    // 79.8 kg → 175.9 lb (display); stored value stays kg.
    expect(getByTestId("weigh-in-input").props.value).toBe("175.9");
  });

  it("steppers adjust the weight", () => {
    const { getByLabelText, getByTestId } = render();
    fireEvent.press(getByLabelText("Increase weight"));
    expect(getByTestId("weigh-in-input").props.value).toBe("79.9");
    fireEvent.press(getByLabelText("Decrease weight"));
    expect(getByTestId("weigh-in-input").props.value).toBe("79.8");
  });

  it("does not clobber a typed weight when a late prefill lands", () => {
    // Apple Health reads resolve AFTER the sheet opens, so `defaultWeightKg`
    // changes mid-edit. A value the user has already touched must survive.
    const { getByLabelText, getByTestId, rerender } = render({
      defaultWeightKg: undefined,
    });
    fireEvent.press(getByLabelText("Increase weight")); // 79.8 → 79.9 (edited)
    expect(getByTestId("weigh-in-input").props.value).toBe("79.9");
    rerender(
      <WeighInSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={jest.fn()}
        history={[80.5, 80.2, 79.9, 79.8]}
        today={TODAY}
        defaultWeightKg={75}
      />,
    );
    expect(getByTestId("weigh-in-input").props.value).toBe("79.9");
  });

  it("seeds an untouched field from a late prefill", () => {
    // The flip-side: a field the user has NOT touched still accepts the late
    // HealthKit reading, so the freshest value populates the form.
    const { getByTestId, rerender } = render({ defaultWeightKg: undefined });
    expect(getByTestId("weigh-in-input").props.value).toBe("79.8"); // history seed
    rerender(
      <WeighInSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={jest.fn()}
        history={[80.5, 80.2, 79.9, 79.8]}
        today={TODAY}
        defaultWeightKg={75}
        defaultBodyFat={16}
      />,
    );
    expect(getByTestId("weigh-in-input").props.value).toBe("75.0");
    expect(getByTestId("weigh-in-bodyfat-input").props.value).toBe("16");
  });

  it("picks a past day via the date chips", () => {
    const { getByLabelText, getByText, onSave } = render();
    fireEvent.press(getByLabelText("Yesterday"));
    fireEvent.press(getByText(/Log 79.8 kg · Yesterday/));
    expect(onSave).toHaveBeenCalledWith({
      weightKg: 79.8,
      bodyFatPercentage: null,
      day: "2026-06-09",
      unit: "kg",
    });
  });
});
