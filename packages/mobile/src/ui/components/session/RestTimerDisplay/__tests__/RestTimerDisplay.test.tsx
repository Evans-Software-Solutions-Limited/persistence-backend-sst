import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { RestTimerDisplay } from "../RestTimerDisplay";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

describe("RestTimerDisplay", () => {
  const baseProps = {
    isActive: true,
    remainingSeconds: 65,
    totalSeconds: 90,
    progress: 0.27,
    onSkip: jest.fn(),
    onExtend: jest.fn(),
    onDismiss: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when isActive=false", () => {
    const { queryByTestId } = renderWithTheme(
      <RestTimerDisplay {...baseProps} isActive={false} />,
    );
    expect(queryByTestId("rest-timer-display")).toBeNull();
  });

  it("renders the formatted countdown + Skip / +30s / +60s controls", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <RestTimerDisplay {...baseProps} />,
    );
    expect(getByTestId("rest-timer-display")).toBeTruthy();
    expect(getByText("1:05")).toBeTruthy(); // 65s formatted
    expect(getByTestId("rest-timer-skip")).toBeTruthy();
    expect(getByTestId("rest-timer-extend-30")).toBeTruthy();
    expect(getByTestId("rest-timer-extend-60")).toBeTruthy();
  });

  it("formats sub-minute durations with a leading zero second", () => {
    const { getByText } = renderWithTheme(
      <RestTimerDisplay {...baseProps} remainingSeconds={5} />,
    );
    expect(getByText("0:05")).toBeTruthy();
  });

  it("renders 0:00 when remainingSeconds hits zero (falsy-zero safe)", () => {
    const { getByText } = renderWithTheme(
      <RestTimerDisplay {...baseProps} remainingSeconds={0} />,
    );
    expect(getByText("0:00")).toBeTruthy();
  });

  it("dispatches onExtend with 30 / 60 and onSkip on the right buttons", () => {
    const { getByTestId } = renderWithTheme(
      <RestTimerDisplay {...baseProps} />,
    );
    fireEvent.press(getByTestId("rest-timer-extend-30"));
    expect(baseProps.onExtend).toHaveBeenCalledWith(30);
    fireEvent.press(getByTestId("rest-timer-extend-60"));
    expect(baseProps.onExtend).toHaveBeenCalledWith(60);
    fireEvent.press(getByTestId("rest-timer-skip"));
    expect(baseProps.onSkip).toHaveBeenCalled();
  });
});
