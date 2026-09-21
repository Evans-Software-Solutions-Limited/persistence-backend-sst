import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  FuelProfileEditor,
  type FuelProfileEditorProps,
} from "../FuelProfileEditor";

function props(
  overrides: Partial<FuelProfileEditorProps> = {},
): FuelProfileEditorProps {
  return {
    state: { field: "age", value: "", inches: "", error: null },
    heightUnit: "cm",
    weightUnit: "kg",
    onChange: jest.fn(),
    onSave: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
}
it("edits DOB and forwards save/cancel", () => {
  const p = props();
  const screen = renderWithTheme(<FuelProfileEditor {...p} />);
  expect(screen.queryByTestId("fuel-profile-value")).toBeNull();
  fireEvent.press(screen.getByTestId("fuel-profile-dob"));
  fireEvent(screen.getByTestId("fuel-profile-dob-drawer-native"), "change", {
    nativeEvent: { timestamp: new Date(1990, 0, 1, 12).getTime() },
  });
  expect(p.onChange).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId("fuel-profile-dob-drawer-confirm"));
  fireEvent.press(screen.getByTestId("fuel-profile-save"));
  fireEvent.press(screen.getByTestId("fuel-profile-cancel"));
  expect(p.onChange).toHaveBeenCalledWith("1990-01-01");
  expect(p.onSave).toHaveBeenCalledTimes(1);
  expect(p.onCancel).toHaveBeenCalledTimes(1);
});
it("shows each sex choice and an inline error", () => {
  const p = props({
    state: {
      field: "gender",
      value: "female",
      inches: "",
      error: "Choose one",
    },
  });
  const screen = renderWithTheme(<FuelProfileEditor {...p} />);
  for (const sex of ["male", "female", "other"])
    fireEvent.press(screen.getByTestId(`fuel-profile-gender-${sex}`));
  expect(p.onChange).toHaveBeenCalledWith("other");
  expect(screen.getByRole("alert")).toBeTruthy();
});
it.each(["cm", "ftin"] as const)(
  "labels height with %s and forwards inches separately",
  (heightUnit) => {
    const p = props({
      state: { field: "height", value: "5", inches: "10", error: null },
      heightUnit,
    });
    const screen = renderWithTheme(<FuelProfileEditor {...p} />);
    expect(
      screen.getByLabelText(`Height (${heightUnit === "cm" ? "cm" : "feet"})`),
    ).toBeTruthy();
    if (heightUnit === "ftin") {
      fireEvent.changeText(screen.getByTestId("fuel-profile-inches"), "8");
      expect(p.onChange).toHaveBeenCalledWith("8", true);
    } else expect(screen.queryByTestId("fuel-profile-inches")).toBeNull();
  },
);
it("explains weight saves to progress and uses pounds", () => {
  const p = props({
    state: { field: "weight", value: "150", inches: "", error: null },
    weightUnit: "lb",
  });
  const screen = renderWithTheme(<FuelProfileEditor {...p} />);
  expect(screen.getByLabelText("Weight (lb)")).toBeTruthy();
  expect(screen.getByText(/today's weigh-in/)).toBeTruthy();
});

it("dismisses the quick-fill drawer without saving", () => {
  const p = props();
  const screen = renderWithTheme(<FuelProfileEditor {...p} />);
  fireEvent(screen.getByTestId("gorhom-bottom-sheet"), "onClose");
  expect(p.onCancel).toHaveBeenCalledTimes(1);
  expect(p.onSave).not.toHaveBeenCalled();
});

it("offers all height entry formats and separate metre/centimetre fields", () => {
  const onHeightFormatChange = jest.fn();
  const p = props({
    state: {
      field: "height",
      value: "1",
      inches: "78",
      error: null,
      heightFormat: "mcm",
    },
    onHeightFormatChange,
  });
  const screen = renderWithTheme(<FuelProfileEditor {...p} />);
  expect(screen.getByLabelText("Height (metres)").props.value).toBe("1");
  fireEvent.changeText(
    screen.getByLabelText("Height (remaining centimetres)"),
    "80",
  );
  expect(p.onChange).toHaveBeenCalledWith("80", true);
  for (const format of ["cm", "in", "mcm", "ftin"])
    fireEvent.press(screen.getByTestId(`fuel-height-format-${format}`));
  expect(onHeightFormatChange.mock.calls.map((call) => call[0])).toEqual([
    "cm",
    "in",
    "mcm",
    "ftin",
  ]);
});
