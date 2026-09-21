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

  it("logs body fat without fabricating a weight from the hidden default", () => {
    const { getByTestId, queryByTestId, onSave } = render({
      context: "bodyFat",
      history: [],
    });

    expect(queryByTestId("weigh-in-input")).toBeNull();
    fireEvent.changeText(getByTestId("weigh-in-bodyfat-input"), "21.4");
    fireEvent.press(getByTestId("weigh-in-save"));

    expect(onSave).toHaveBeenCalledWith({
      weightKg: undefined,
      bodyFatPercentage: 21.4,
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
    // weightUnit preference) is `undefined` at first mount and resolves
    // moments later — same async-after-open shape as the weight/body-fat
    // prefills.
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

  it("keeps invalid text visible without saving a previous value", () => {
    const { getByTestId, onSave } = render();
    fireEvent.changeText(getByTestId("weigh-in-input"), "-50");
    expect(getByTestId("weigh-in-input").props.value).toBe("-50");
    fireEvent.press(getByTestId("weigh-in-save"));
    expect(onSave).not.toHaveBeenCalled();
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

  it("keeps a cleared entry empty when switching units", () => {
    const { getByTestId, getByLabelText } = render();
    fireEvent.changeText(getByTestId("weigh-in-input"), "");
    fireEvent.press(getByLabelText("Use lb"));
    expect(getByTestId("weigh-in-input").props.value).toBe("");
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

describe("weight entry formats", () => {
  it.each([["st+lb", "10", "7", 147]])(
    "converts %s to canonical kg and retains pound preference",
    (format, first, second, pounds) => {
      const { getByLabelText, getByTestId, onSave } = render();
      fireEvent.press(getByLabelText(`Use ${format}`));
      fireEvent.changeText(getByTestId("weigh-in-input"), first);
      if (second !== null)
        fireEvent.changeText(getByTestId("weigh-in-remainder-input"), second);
      fireEvent.press(getByTestId("weigh-in-save"));
      expect(onSave.mock.calls[0][0].weightKg).toBeCloseTo(
        Number(pounds) * 0.45359237,
        7,
      );
      expect(onSave.mock.calls[0][0].unit).toBe("lb");
    },
  );

  it("switches formats without drift and rounds once when saving", () => {
    const { getByLabelText, getByTestId, onSave } = render({
      defaultWeightKg: 73.123456,
    });
    for (const format of ["lb", "st+lb", "kg"])
      fireEvent.press(getByLabelText(`Use ${format}`));
    fireEvent.press(getByTestId("weigh-in-save"));
    expect(onSave.mock.calls[0][0].weightKg).toBe(73.1);
  });

  it.each(["", "Infinity", "NaN", "12abc", "-1", "0", "1000"])(
    "does not save invalid entry %s",
    (text) => {
      const { getByTestId, onSave } = render();
      fireEvent.changeText(getByTestId("weigh-in-input"), text);
      fireEvent.press(getByTestId("weigh-in-save"));
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["st+lb", "14"],
    ["st+lb", ""],
  ])("rejects invalid %s remainder %s", (format, remainder) => {
    const { getByLabelText, getByTestId, onSave } = render();
    fireEvent.press(getByLabelText(`Use ${format}`));
    fireEvent.changeText(getByTestId("weigh-in-remainder-input"), remainder);
    fireEvent.press(getByTestId("weigh-in-save"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("preserves a manually selected format when preferences arrive late", () => {
    const { getByLabelText, getByTestId, rerender } = render();
    fireEvent.press(getByLabelText("Use st+lb"));
    fireEvent.changeText(getByTestId("weigh-in-input"), "10");
    fireEvent.changeText(getByTestId("weigh-in-remainder-input"), "7");
    rerender(
      <WeighInSheetPresenter
        visible
        onSave={jest.fn()}
        onClose={jest.fn()}
        defaultUnit="kg"
        defaultWeightKg={90}
      />,
    );
    expect(getByTestId("weigh-in-input").props.value).toBe("10");
    expect(getByTestId("weigh-in-remainder-input").props.value).toBe("7");
  });
});

describe("weight format boundaries", () => {
  it.each([["st+lb", 153.99, "11", "0.0"]])(
    "normalizes rounded %s remainders",
    (format, pounds, primary, remainder) => {
      const { getByLabelText, getByTestId, onSave } = render({
        defaultWeightKg: Number(pounds) * 0.45359237,
      });
      fireEvent.press(getByLabelText(`Use ${format}`));
      expect(getByTestId("weigh-in-input").props.value).toBe(primary);
      expect(getByTestId("weigh-in-remainder-input").props.value).toBe(
        remainder,
      );
      fireEvent.press(getByTestId("weigh-in-save"));
      expect(onSave.mock.calls[0][0].weightKg).toBe(154 * 0.45359237);
    },
  );
  it("never resurrects an invalid value through a unit change or stepper", () => {
    const { getByLabelText, getByTestId, onSave } = render();
    fireEvent.changeText(getByTestId("weigh-in-input"), "-50");
    fireEvent.press(getByLabelText("Increase weight"));
    fireEvent.press(getByLabelText("Use st+lb"));
    fireEvent.press(getByTestId("weigh-in-save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(getByTestId("weigh-in-input").props.value).toBe("");
  });
});

it("retains valid boundary measurements when changing display formats", () => {
  const { getByLabelText, getByTestId, onSave } = render({
    defaultWeightKg: 999,
  });
  for (const format of ["lb", "st+lb"]) {
    fireEvent.press(getByLabelText(`Use ${format}`));
    fireEvent.press(getByTestId("weigh-in-save"));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ weightKg: 2202.4 * 0.45359237 }),
    );
  }
});

describe("localized weight input", () => {
  it("accepts a decimal comma in kilograms", () => {
    const { getByTestId, onSave } = render();
    fireEvent.changeText(getByTestId("weigh-in-input"), "80,5");
    fireEvent.press(getByTestId("weigh-in-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ weightKg: 80.5 }),
    );
  });
  it("accepts a decimal comma in the pounds remainder", () => {
    const { getByTestId, getByLabelText, onSave } = render();
    fireEvent.press(getByLabelText("Use st+lb"));
    fireEvent.changeText(getByTestId("weigh-in-input"), "11");
    fireEvent.changeText(getByTestId("weigh-in-remainder-input"), "2,5");
    fireEvent.press(getByTestId("weigh-in-save"));
    expect(onSave.mock.calls[0][0].weightKg).toBeCloseTo(156.5 * 0.45359237, 8);
  });
  it.each(["80,5.2", "80.5,2", "80,,5", "80,5,2"])(
    "rejects malformed separators in %s",
    (text) => {
      const { getByTestId, onSave } = render();
      fireEvent.changeText(getByTestId("weigh-in-input"), text);
      fireEvent.press(getByTestId("weigh-in-save"));
      expect(onSave).not.toHaveBeenCalled();
    },
  );
  it.each(["2,5.2", "2,5,2"])(
    "rejects malformed remainder separators in %s",
    (text) => {
      const { getByTestId, getByLabelText, onSave } = render();
      fireEvent.press(getByLabelText("Use st+lb"));
      fireEvent.changeText(getByTestId("weigh-in-remainder-input"), text);
      fireEvent.press(getByTestId("weigh-in-save"));
      expect(onSave).not.toHaveBeenCalled();
    },
  );
});

it("logs the displayed one-decimal Health-prefilled measurement", () => {
  const { getByTestId, onSave } = render({ defaultWeightKg: 80.123456 });
  expect(getByTestId("weigh-in-input").props.value).toBe("80.1");
  fireEvent.press(getByTestId("weigh-in-save"));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ weightKg: 80.1 }),
  );
});
it("normalizes typed precision to the logged value", () => {
  const { getByTestId, onSave } = render();
  fireEvent.changeText(getByTestId("weigh-in-input"), "80.12345");
  fireEvent.press(getByTestId("weigh-in-save"));
  expect(getByTestId("weigh-in-input").props.value).toBe("80.1");
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ weightKg: 80.1 }),
  );
});
it("does not log a tiny value rounded to zero", () => {
  const { getByTestId, onSave } = render();
  fireEvent.changeText(getByTestId("weigh-in-input"), "0.01");
  fireEvent.press(getByTestId("weigh-in-save"));
  expect(onSave).not.toHaveBeenCalled();
});
it("offers only kilograms, pounds and stone with pounds", () => {
  const { queryByLabelText } = render();
  expect(queryByLabelText("Use oz")).toBeNull();
  expect(queryByLabelText("Use lb+oz")).toBeNull();
});

it("formats a precise edit to one decimal when leaving the field", () => {
  const { getByTestId } = render();
  fireEvent.changeText(getByTestId("weigh-in-input"), "80.126");
  fireEvent(getByTestId("weigh-in-input"), "blur");
  expect(getByTestId("weigh-in-input").props.value).toBe("80.1");
});

describe("weigh-in date picker", () => {
  it("opens the shared drawer and saves a confirmed older date", () => {
    const { getByTestId, getByText, onSave } = render();
    fireEvent.press(getByTestId("weigh-in-date"));
    expect(getByTestId("weigh-in-date-drawer-wheels")).toBeTruthy();
    fireEvent(getByTestId("weigh-in-date-drawer-native"), "change", {
      nativeEvent: { timestamp: new Date(2026, 4, 15, 12).getTime() },
    });
    fireEvent.press(getByTestId("weigh-in-date-drawer-confirm"));
    expect(getByText("Log 79.8 kg · 15 May 2026")).toBeTruthy();
    fireEvent.press(getByTestId("weigh-in-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ day: "2026-05-15", weightKg: 79.8 }),
    );
  });

  it("keeps today when an unconfirmed date drawer is dismissed", () => {
    const { getByTestId, onSave } = render();
    fireEvent.press(getByTestId("weigh-in-date"));
    fireEvent(getByTestId("weigh-in-date-drawer-native"), "change", {
      nativeEvent: { timestamp: new Date(2026, 4, 15, 12).getTime() },
    });
    fireEvent(getByTestId("weigh-in-date-drawer"), "close");
    fireEvent.press(getByTestId("weigh-in-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ day: "2026-06-10" }),
    );
  });

  it("rejects future dates and permits returning to a recent-day shortcut", () => {
    const { getByTestId, getByLabelText, onSave } = render();
    fireEvent.press(getByTestId("weigh-in-date"));
    fireEvent(getByTestId("weigh-in-date-drawer-native"), "change", {
      nativeEvent: { timestamp: new Date(2026, 5, 11, 12).getTime() },
    });
    fireEvent.press(getByTestId("weigh-in-date-drawer-confirm"));
    fireEvent.press(getByTestId("weigh-in-save"));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ day: "2026-06-10" }),
    );
    fireEvent.press(getByLabelText("Yesterday"));
    fireEvent.press(getByTestId("weigh-in-save"));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ day: "2026-06-09" }),
    );
  });
});

it("preserves a selected date across midnight and resets on the next open", () => {
  const onSave = jest.fn();
  const props = {
    visible: true,
    onSave,
    onClose: jest.fn(),
    defaultWeightKg: 80,
  };
  const screen = renderWithTheme(
    <WeighInSheetPresenter {...props} today={TODAY} />,
  );
  fireEvent.press(screen.getByTestId("weigh-in-date"));
  fireEvent(screen.getByTestId("weigh-in-date-drawer-native"), "change", {
    nativeEvent: { timestamp: new Date(2026, 4, 15, 12).getTime() },
  });
  fireEvent.press(screen.getByTestId("weigh-in-date-drawer-confirm"));
  const tomorrow = new Date("2026-06-11T12:00:00Z");
  screen.rerender(<WeighInSheetPresenter {...props} today={tomorrow} />);
  fireEvent.press(screen.getByTestId("weigh-in-save"));
  expect(onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ day: "2026-05-15" }),
  );
  fireEvent.press(screen.getByLabelText("Today"));
  fireEvent.press(screen.getByTestId("weigh-in-save"));
  expect(onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ day: "2026-06-11" }),
  );
  screen.rerender(
    <WeighInSheetPresenter {...props} visible={false} today={tomorrow} />,
  );
  screen.rerender(<WeighInSheetPresenter {...props} today={tomorrow} />);
  fireEvent.press(screen.getByTestId("weigh-in-save"));
  expect(onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ day: "2026-06-11" }),
  );
});
