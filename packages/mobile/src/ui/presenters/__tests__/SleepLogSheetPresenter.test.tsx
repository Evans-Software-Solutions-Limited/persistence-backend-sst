import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { SleepLogSheetPresenter } from "../SleepLogSheetPresenter";

function render(overrides = {}) {
  const onSave = jest.fn();
  const onClose = jest.fn();
  const utils = renderWithTheme(
    <SleepLogSheetPresenter
      visible
      onClose={onClose}
      onSave={onSave}
      {...overrides}
    />,
  );
  return { ...utils, onSave, onClose };
}

describe("SleepLogSheetPresenter", () => {
  it("renders with a default 8h 0m duration when no prefill is given", () => {
    const { getByTestId } = render();
    expect(getByTestId("sleep-log-sheet")).toBeTruthy();
    expect(getByTestId("sleep-hours-value").props.children).toBe(8);
    expect(getByTestId("sleep-minutes-value").props.children).toBe(0);
  });

  it("seeds hours + minutes from a HealthKit prefill (Decision D1: duration input)", () => {
    const { getByTestId } = render({ defaultDurationMinutes: 450 }); // 7h30m
    expect(getByTestId("sleep-hours-value").props.children).toBe(7);
    expect(getByTestId("sleep-minutes-value").props.children).toBe(30);
  });

  it("saves the total duration in minutes", () => {
    const { getByText, onSave } = render({ defaultDurationMinutes: 450 });
    fireEvent.press(getByText(/Log 7h 30m/));
    expect(onSave).toHaveBeenCalledWith({ durationMinutes: 450 });
  });

  it("steppers adjust hours and minutes", () => {
    const { getByLabelText, getByTestId } = render({
      defaultDurationMinutes: 450,
    });
    fireEvent.press(getByLabelText("Increase hours"));
    expect(getByTestId("sleep-hours-value").props.children).toBe(8);
    fireEvent.press(getByLabelText("Decrease minutes"));
    expect(getByTestId("sleep-minutes-value").props.children).toBe(25);
  });

  it("clamps the hours stepper to [0, 16]", () => {
    const { getByLabelText, getByTestId } = render({
      defaultDurationMinutes: 0,
    });
    fireEvent.press(getByLabelText("Decrease hours"));
    expect(getByTestId("sleep-hours-value").props.children).toBe(0);
    for (let i = 0; i < 17; i++)
      fireEvent.press(getByLabelText("Increase hours"));
    expect(getByTestId("sleep-hours-value").props.children).toBe(16);
  });

  it("wraps minutes 0..55 in 5-minute steps", () => {
    const { getByLabelText, getByTestId } = render({
      defaultDurationMinutes: 0,
    });
    fireEvent.press(getByLabelText("Decrease minutes"));
    expect(getByTestId("sleep-minutes-value").props.children).toBe(55);
  });

  it("disables Save when the total duration is 0", () => {
    const { getByText, onSave } = render({ defaultDurationMinutes: 0 });
    fireEvent.press(getByText(/Log 0h 0m/));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not clobber an edited value when a late prefill lands", () => {
    const { getByLabelText, getByTestId, rerender } = render({
      defaultDurationMinutes: undefined,
    });
    fireEvent.press(getByLabelText("Increase hours")); // 8h -> 9h (edited)
    expect(getByTestId("sleep-hours-value").props.children).toBe(9);
    rerender(
      <SleepLogSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={jest.fn()}
        defaultDurationMinutes={420}
      />,
    );
    expect(getByTestId("sleep-hours-value").props.children).toBe(9);
  });

  it("seeds an untouched field from a late prefill", () => {
    const { getByTestId, rerender } = render({
      defaultDurationMinutes: undefined,
    });
    expect(getByTestId("sleep-hours-value").props.children).toBe(8);
    rerender(
      <SleepLogSheetPresenter
        visible
        onClose={jest.fn()}
        onSave={jest.fn()}
        defaultDurationMinutes={375} // 6h15m
      />,
    );
    expect(getByTestId("sleep-hours-value").props.children).toBe(6);
    expect(getByTestId("sleep-minutes-value").props.children).toBe(15);
  });

  it("shows the saving state on the Save CTA", () => {
    const { getByText } = render({ saving: true });
    expect(getByText("Logged ✓")).toBeTruthy();
  });
});
