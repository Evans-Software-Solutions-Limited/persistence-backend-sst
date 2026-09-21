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
  fireEvent.changeText(
    screen.getByLabelText("Date of birth (YYYY-MM-DD)"),
    "1990-01-01",
  );
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
