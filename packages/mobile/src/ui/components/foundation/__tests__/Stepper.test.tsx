import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Stepper } from "../Stepper";

describe("Stepper", () => {
  it("renders the label, value, and unit", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <Stepper
        label="REST"
        value={60}
        unit="s"
        onDec={jest.fn()}
        onInc={jest.fn()}
        onType={jest.fn()}
        testID="rest-input"
      />,
    );
    expect(getByText("REST")).toBeTruthy();
    expect(getByText("s")).toBeTruthy();
    expect(getByTestId("rest-input").props.value).toBe("60");
  });

  it("fires onDec / onInc from the ± buttons", () => {
    const onDec = jest.fn();
    const onInc = jest.fn();
    const { getByTestId } = renderWithTheme(
      <Stepper
        label="SETS"
        value={3}
        onDec={onDec}
        onInc={onInc}
        onType={jest.fn()}
        testID="sets-input"
      />,
    );
    fireEvent.press(getByTestId("sets-input-dec"));
    expect(onDec).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId("sets-input-inc"));
    expect(onInc).toHaveBeenCalledTimes(1);
  });

  it("fires onType on every keystroke and onBlur with the buffered text", () => {
    const onType = jest.fn();
    const onBlur = jest.fn();
    const { getByTestId } = renderWithTheme(
      <Stepper
        label="SETS"
        value={3}
        onDec={jest.fn()}
        onInc={jest.fn()}
        onType={onType}
        onBlur={onBlur}
        testID="sets-input"
      />,
    );
    fireEvent.changeText(getByTestId("sets-input"), "5");
    expect(onType).toHaveBeenCalledWith("5");
    fireEvent(getByTestId("sets-input"), "blur");
    expect(onBlur).toHaveBeenCalledWith("5");
  });

  it("keeps the buffer empty (no 0-flash) while the field is mid-edit", () => {
    const { getByTestId } = renderWithTheme(
      <Stepper
        label="SETS"
        value={3}
        onDec={jest.fn()}
        onInc={jest.fn()}
        onType={jest.fn()}
        testID="sets-input"
      />,
    );
    fireEvent.changeText(getByTestId("sets-input"), "");
    expect(getByTestId("sets-input").props.value).toBe("");
  });

  it("renders without a testID, unit, or onBlur (blur is a safe no-op)", () => {
    const { getByText, queryByText, getByLabelText } = renderWithTheme(
      <Stepper
        label="SETS"
        value={3}
        onDec={jest.fn()}
        onInc={jest.fn()}
        onType={jest.fn()}
      />,
    );
    // No unit label rendered when `unit` is omitted.
    expect(getByText("SETS")).toBeTruthy();
    expect(queryByText("s")).toBeNull();
    // Blur with no onBlur handler must not throw (optional-chaining branch);
    // the input is reachable via its accessibilityLabel (no testID passed).
    const input = getByLabelText("SETS");
    expect(() => fireEvent(input, "blur")).not.toThrow();
  });

  it("dims the control, disables editing, and suppresses ± taps when disabled", () => {
    const onDec = jest.fn();
    const onInc = jest.fn();
    const { getByTestId } = renderWithTheme(
      <Stepper
        label="SETS"
        value={4}
        disabled
        onDec={onDec}
        onInc={onInc}
        onType={jest.fn()}
        testID="sets-input"
      />,
    );
    expect(getByTestId("sets-input").props.editable).toBe(false);
    fireEvent.press(getByTestId("sets-input-dec"));
    fireEvent.press(getByTestId("sets-input-inc"));
    expect(onDec).not.toHaveBeenCalled();
    expect(onInc).not.toHaveBeenCalled();
  });
});
