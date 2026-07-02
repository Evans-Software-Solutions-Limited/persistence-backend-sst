import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  LogClientWeightPresenter,
  type LogClientWeightProps,
} from "../LogClientWeightPresenter";

function render(over: Partial<LogClientWeightProps> = {}) {
  const props: LogClientWeightProps = {
    clientName: "Jordan",
    saving: false,
    success: false,
    error: null,
    onSave: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
  return { props, ...renderWithTheme(<LogClientWeightPresenter {...props} />) };
}

describe("LogClientWeightPresenter", () => {
  it("renders the client name and default weight", () => {
    const { getByText, getByTestId } = render();
    expect(getByText("Logging for Jordan")).toBeTruthy();
    expect(getByTestId("log-client-weight-input").props.value).toBe("80.0");
  });

  it("saves the typed weight in kg (body fat null when untouched)", () => {
    const { props, getByTestId } = render();
    fireEvent.changeText(getByTestId("log-client-weight-input"), "82.5");
    fireEvent.press(getByTestId("log-client-weight-save"));
    expect(props.onSave).toHaveBeenCalledWith({
      weightKg: 82.5,
      bodyFatPercentage: null,
    });
  });

  it("steps the weight up and down", () => {
    const { props, getByTestId, getByLabelText } = render();
    fireEvent.press(getByLabelText("Increase weight"));
    fireEvent.press(getByTestId("log-client-weight-save"));
    expect(props.onSave).toHaveBeenCalledWith({
      weightKg: 80.1,
      bodyFatPercentage: null,
    });
  });

  it("converts a lb entry back to kg on save", () => {
    const { props, getByTestId, getByLabelText } = render();
    fireEvent.press(getByLabelText("Use lb"));
    fireEvent.changeText(getByTestId("log-client-weight-input"), "220");
    fireEvent.press(getByTestId("log-client-weight-save"));
    const { weightKg } = (props.onSave as jest.Mock).mock.calls[0][0];
    expect(weightKg).toBeCloseTo(99.79, 1);
  });

  it("includes a typed body fat, clamped to 0..100", () => {
    const { props, getByTestId } = render();
    fireEvent.changeText(getByTestId("log-client-bodyfat-input"), "19.5");
    fireEvent.press(getByTestId("log-client-weight-save"));
    expect(props.onSave).toHaveBeenCalledWith({
      weightKg: 80,
      bodyFatPercentage: 19.5,
    });

    fireEvent.changeText(getByTestId("log-client-bodyfat-input"), "250");
    fireEvent.press(getByTestId("log-client-weight-save"));
    expect(props.onSave).toHaveBeenLastCalledWith({
      weightKg: 80,
      bodyFatPercentage: 100,
    });
  });

  it("clearing the body-fat field reverts it to null (optional field)", () => {
    const { props, getByTestId } = render();
    fireEvent.changeText(getByTestId("log-client-bodyfat-input"), "19.5");
    fireEvent.changeText(getByTestId("log-client-bodyfat-input"), "");
    expect(getByTestId("log-client-bodyfat-input").props.value).toBe("");
    fireEvent.press(getByTestId("log-client-weight-save"));
    expect(props.onSave).toHaveBeenCalledWith({
      weightKg: 80,
      bodyFatPercentage: null,
    });
  });

  it("can be cleared to an empty string and retyped", () => {
    // Regression: deriving `value` from a parsed number meant deleting all
    // the digits produced NaN, the handler bailed, and the field snapped
    // back to the last valid number — it could never be cleared.
    const { getByTestId } = render();
    fireEvent.changeText(getByTestId("log-client-weight-input"), "");
    expect(getByTestId("log-client-weight-input").props.value).toBe("");
    fireEvent.changeText(getByTestId("log-client-weight-input"), "9");
    expect(getByTestId("log-client-weight-input").props.value).toBe("9");
  });

  it("reformats the field from the last valid value when the unit toggles mid-edit", () => {
    const { getByTestId, getByLabelText } = render();
    fireEvent.changeText(getByTestId("log-client-weight-input"), "");
    fireEvent.press(getByLabelText("Use lb"));
    expect(getByTestId("log-client-weight-input").props.value).toBe("176.4");
  });

  it("shows the success label and disables save", () => {
    const { props, getByText, getByTestId } = render({ success: true });
    expect(getByText("Logged ✓")).toBeTruthy();
    fireEvent.press(getByTestId("log-client-weight-save"));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("surfaces an error message", () => {
    const { getByTestId } = render({ error: "Nope" });
    expect(getByTestId("log-client-weight-error")).toBeTruthy();
  });

  it("invokes onBack", () => {
    const { props, getByLabelText } = render();
    fireEvent.press(getByLabelText("Back"));
    expect(props.onBack).toHaveBeenCalled();
  });
});
