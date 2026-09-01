import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";

import { DateCalendarModal, DatePickerField } from "../DatePickerField";

describe("DatePickerField", () => {
  it("persists the selected date as an ISO calendar day", () => {
    const onChange = jest.fn();
    const screen = renderWithTheme(
      <DatePickerField
        label="Date of birth"
        value="1994-03-12"
        onChange={onChange}
        maximumDate="2026-09-01"
      />,
    );

    fireEvent.press(screen.getByTestId("date-picker-field"));
    fireEvent.press(
      screen.getByTestId("date-picker-field-calendar-day-1994-03-08"),
    );

    expect(onChange).toHaveBeenCalledWith("1994-03-08");
  });

  it("supports clearing an optional date", () => {
    const onChange = jest.fn();
    const screen = renderWithTheme(
      <DatePickerField
        label="Date of birth"
        value="1994-03-12"
        onChange={onChange}
      />,
    );

    fireEvent.press(screen.getByTestId("date-picker-field"));
    fireEvent.press(screen.getByTestId("date-picker-field-calendar-clear"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("DateCalendarModal", () => {
  it("offers direct year and month navigation for birth dates", () => {
    const screen = renderWithTheme(
      <DateCalendarModal
        visible
        selectedDate="1994-03-12"
        minimumDate="1900-01-01"
        maximumDate="2026-09-01"
        onSelectDate={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId("date-calendar-modal-year-selector"));
    expect(screen.getByTestId("date-calendar-modal-year-1994")).toBeTruthy();
    fireEvent.press(screen.getByTestId("date-calendar-modal-year-1994"));
    fireEvent.press(screen.getByTestId("date-calendar-modal-month-8"));
    expect(
      screen.getByTestId("date-calendar-modal-day-1994-08-12"),
    ).toBeTruthy();
  });

  it("enforces minimum and maximum dates accessibly", () => {
    const screen = renderWithTheme(
      <DateCalendarModal
        visible
        selectedDate="2026-08-15"
        minimumDate="2026-08-10"
        maximumDate="2026-08-20"
        onSelectDate={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(
      screen.getByTestId("date-calendar-modal-day-2026-08-09").props
        .accessibilityState.disabled,
    ).toBe(true);
    expect(
      screen.getByTestId("date-calendar-modal-day-2026-08-21").props
        .accessibilityState.disabled,
    ).toBe(true);
  });
});
