import { act, fireEvent } from "@testing-library/react-native";
import React from "react";
import { SessionHeader } from "../SessionHeader";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

describe("SessionHeader", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the formatted live duration + exercise progress", () => {
    let now = Date.parse("2026-05-05T10:00:30.000Z");
    const { getByText, getByTestId } = renderWithTheme(
      <SessionHeader
        startedAt="2026-05-05T10:00:00.000Z"
        sessionName="Push Day"
        exerciseIndex={2}
        totalExercises={4}
        onClose={jest.fn()}
        clock={() => now}
      />,
    );
    expect(getByText("Push Day")).toBeTruthy();
    expect(getByText("0:30 · Exercise 2 of 4")).toBeTruthy();

    act(() => {
      now += 60_000;
      jest.advanceTimersByTime(1_000);
    });
    expect(getByText("1:30 · Exercise 2 of 4")).toBeTruthy();
    expect(getByTestId("session-header")).toBeTruthy();
  });

  it("formats over-an-hour durations as h:mm:ss", () => {
    const { getByText } = renderWithTheme(
      <SessionHeader
        startedAt="2026-05-05T08:00:00.000Z"
        sessionName="Marathon"
        exerciseIndex={1}
        totalExercises={1}
        onClose={jest.fn()}
        clock={() => Date.parse("2026-05-05T10:01:05.000Z")}
      />,
    );
    expect(getByText("2:01:05 · Exercise 1 of 1")).toBeTruthy();
  });

  it("falls back to 0 elapsed when startedAt is unparsable", () => {
    const { getByText } = renderWithTheme(
      <SessionHeader
        startedAt="not-an-iso"
        sessionName="X"
        exerciseIndex={1}
        totalExercises={1}
        onClose={jest.fn()}
        clock={() => Date.parse("2026-05-05T10:00:00.000Z")}
      />,
    );
    expect(getByText("0:00 · Exercise 1 of 1")).toBeTruthy();
  });

  it("dispatches onClose on close button press", () => {
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionHeader
        startedAt="2026-05-05T10:00:00.000Z"
        sessionName="X"
        exerciseIndex={1}
        totalExercises={1}
        onClose={onClose}
        clock={() => Date.parse("2026-05-05T10:00:00.000Z")}
      />,
    );
    fireEvent.press(getByTestId("session-header-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
