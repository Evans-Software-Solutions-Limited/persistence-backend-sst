import { fireEvent } from "@testing-library/react-native";
import { Platform } from "react-native";
import {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { renderWithTheme } from "../../../../__tests__/test-utils";

import { DateCalendarModal, DatePickerField } from "../DatePickerField";

describe("DatePickerField", () => {
  const originalPlatform = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: originalPlatform,
    });
    jest.restoreAllMocks();
  });

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

    fireEvent(screen.getByTestId("date-picker-field-native"), "change", {
      nativeEvent: { timestamp: new Date(1994, 2, 8, 12).getTime() },
    });

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

    fireEvent.press(screen.getByTestId("date-picker-field-clear"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("opens Android's native picker with bounds and ignores dismissals", () => {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "android",
    });
    const open = jest
      .spyOn(DateTimePickerAndroid, "open")
      .mockImplementation(() => undefined);
    const onChange = jest.fn();
    const screen = renderWithTheme(
      <DatePickerField
        label="Date of birth"
        value="1994-03-12"
        minimumDate="1900-01-01"
        maximumDate="2026-09-01"
        onChange={onChange}
      />,
    );

    fireEvent.press(screen.getByTestId("date-picker-field"));

    expect(open).toHaveBeenCalledTimes(1);
    const options = open.mock.calls[0]?.[0];
    expect(options?.display).toBe("default");
    expect(options?.minimumDate).toEqual(new Date(1900, 0, 1, 12));
    expect(options?.maximumDate).toEqual(new Date(2026, 8, 1, 12));

    options?.onChange?.(
      { type: "dismissed" } as DateTimePickerEvent,
      new Date(1994, 2, 8, 12),
    );
    expect(onChange).not.toHaveBeenCalled();

    options?.onChange?.(
      { type: "set" } as DateTimePickerEvent,
      new Date(1994, 2, 8, 12),
    );
    expect(onChange).toHaveBeenCalledWith("1994-03-08");
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
