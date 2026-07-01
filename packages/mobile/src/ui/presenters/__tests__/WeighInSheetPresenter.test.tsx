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

  it("seeds the unit toggle once a late-arriving defaultUnit lands (profile resolves after mount)", () => {
    // The container's `defaultUnit` (derived from the profile's
    // preferredUnits) is `undefined` at first mount and resolves moments
    // later — same async-after-open shape as the weight/body-fat prefills.
    const { getByTestId, rerender } = render({ defaultUnit: undefined });
    expect(getByTestId("weigh-in-input").props.value).toBe("79.8"); // kg
    rerender(
      <WeighInSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={jest.fn()}
        history={[80.5, 80.2, 79.9, 79.8]}
        today={TODAY}
        defaultUnit="lb"
      />,
    );
    // 79.8kg → 175.9lb.
    expect(getByTestId("weigh-in-input").props.value).toBe("175.9");
  });

  it("does not re-seed the unit toggle from a later defaultUnit change (a manual toggle wins)", () => {
    const { getByTestId, getByLabelText, rerender } = render({
      defaultUnit: "kg",
    });
    fireEvent.press(getByLabelText("Use lb"));
    expect(getByTestId("weigh-in-input").props.value).toBe("175.9");
    // The container's defaultUnit flips back to "kg" (e.g. profile refetch)
    // — the one-shot seed already fired, so the user's manual choice stands.
    rerender(
      <WeighInSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={jest.fn()}
        history={[80.5, 80.2, 79.9, 79.8]}
        today={TODAY}
        defaultUnit="kg"
      />,
    );
    expect(getByTestId("weigh-in-input").props.value).toBe("175.9");
  });

  it("floors the stepper so minus can't drive the weight non-positive", () => {
    // §3: seeded just above the floor, spamming Decrease must clamp at MIN (1
    // kg) — never 0 or negative, which logMeasurementCommand rejects (silent
    // dead-end before this guard).
    const { getByLabelText, getByTestId } = render({ defaultWeightKg: 1.0 });
    expect(getByTestId("weigh-in-input").props.value).toBe("1.0");
    fireEvent.press(getByLabelText("Decrease weight"));
    fireEvent.press(getByLabelText("Decrease weight"));
    fireEvent.press(getByLabelText("Decrease weight"));
    expect(getByTestId("weigh-in-input").props.value).toBe("1.0");
  });

  it("leaves a typed out-of-range weight unclamped (the command gates it on save)", () => {
    // §3: only the stepper is floored. A deliberately-typed bad value still
    // flows through so logMeasurementCommand can reject it and the container
    // can keep the sheet open to correct (gate covered by WeighInSheetContainer).
    // The field shows the raw typed text verbatim (not reformatted) — see the
    // "can be cleared" test below for why.
    const { getByTestId, onSave, getByText } = render();
    fireEvent.changeText(getByTestId("weigh-in-input"), "-50");
    expect(getByTestId("weigh-in-input").props.value).toBe("-50");
    fireEvent.press(getByText(/Log/));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ weightKg: -50 }),
    );
  });

  it("can be cleared to an empty string and retyped, unlike the old parse-and-reformat input", () => {
    // The regression this fix targets: deriving `value` from a parsed number
    // meant deleting all the digits produced NaN, the handler bailed, and the
    // controlled input snapped back to the last valid number — the field
    // could never be cleared. Raw text state fixes that.
    const { getByTestId } = render();
    fireEvent.changeText(getByTestId("weigh-in-input"), "");
    expect(getByTestId("weigh-in-input").props.value).toBe("");
    fireEvent.changeText(getByTestId("weigh-in-input"), "6");
    expect(getByTestId("weigh-in-input").props.value).toBe("6");
    fireEvent.changeText(getByTestId("weigh-in-input"), "65");
    expect(getByTestId("weigh-in-input").props.value).toBe("65");
  });

  it("reformats the field from the last valid value when the unit toggles mid-edit", () => {
    const { getByTestId, getByLabelText } = render();
    fireEvent.changeText(getByTestId("weigh-in-input"), "");
    fireEvent.press(getByLabelText("Use lb"));
    // Unit toggle reformats from the canonical (still 79.8kg) — the cleared
    // raw text doesn't leave the field stuck empty.
    expect(getByTestId("weigh-in-input").props.value).toBe("175.9");
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
