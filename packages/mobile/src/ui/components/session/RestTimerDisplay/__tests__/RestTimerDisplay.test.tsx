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

  it("renders the formatted countdown + Stop Timer button (legacy port)", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <RestTimerDisplay {...baseProps} />,
    );
    expect(getByTestId("rest-timer-display")).toBeTruthy();
    // 65s → 01:05 (legacy pads minutes too).
    expect(getByText("01:05")).toBeTruthy();
    expect(getByText("Rest Time")).toBeTruthy();
    expect(getByText("Stop Timer")).toBeTruthy();
    expect(getByTestId("rest-timer-skip")).toBeTruthy();
  });

  it("formats sub-minute durations with a leading-zero minute", () => {
    const { getByText } = renderWithTheme(
      <RestTimerDisplay {...baseProps} remainingSeconds={5} />,
    );
    expect(getByText("00:05")).toBeTruthy();
  });

  it("renders 00:00 when remainingSeconds hits zero (falsy-zero safe)", () => {
    const { getByText } = renderWithTheme(
      <RestTimerDisplay {...baseProps} remainingSeconds={0} />,
    );
    expect(getByText("00:00")).toBeTruthy();
  });

  it("dispatches onSkip when Stop Timer is pressed", () => {
    const onSkip = jest.fn();
    const { getByTestId } = renderWithTheme(
      <RestTimerDisplay {...baseProps} onSkip={onSkip} />,
    );
    fireEvent.press(getByTestId("rest-timer-skip"));
    expect(onSkip).toHaveBeenCalled();
  });
});
