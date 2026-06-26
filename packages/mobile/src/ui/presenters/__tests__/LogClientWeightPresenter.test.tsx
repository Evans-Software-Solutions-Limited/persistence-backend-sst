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

  it("saves the typed weight in kg", () => {
    const { props, getByTestId } = render();
    fireEvent.changeText(getByTestId("log-client-weight-input"), "82.5");
    fireEvent.press(getByTestId("log-client-weight-save"));
    expect(props.onSave).toHaveBeenCalledWith(82.5);
  });

  it("steps the weight up and down", () => {
    const { props, getByTestId, getByLabelText } = render();
    fireEvent.press(getByLabelText("Increase weight"));
    fireEvent.press(getByTestId("log-client-weight-save"));
    expect(props.onSave).toHaveBeenCalledWith(80.1);
  });

  it("converts a lb entry back to kg on save", () => {
    const { props, getByTestId, getByLabelText } = render();
    fireEvent.press(getByLabelText("Use lb"));
    fireEvent.changeText(getByTestId("log-client-weight-input"), "220");
    fireEvent.press(getByTestId("log-client-weight-save"));
    const kg = (props.onSave as jest.Mock).mock.calls[0][0];
    expect(kg).toBeCloseTo(99.79, 1);
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
