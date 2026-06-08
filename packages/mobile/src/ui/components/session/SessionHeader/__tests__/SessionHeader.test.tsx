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

  it("renders the centred workout name and the live elapsed timer", () => {
    let now = Date.parse("2026-05-05T10:00:30.000Z");
    const { getByText, getByTestId } = renderWithTheme(
      <SessionHeader
        startedAt="2026-05-05T10:00:00.000Z"
        sessionName="Push Day"
        onMinimize={() => {}}
        onEnd={() => {}}
        clock={() => now}
      />,
    );
    expect(getByText("Push Day")).toBeTruthy();
    expect(getByTestId("session-header-elapsed").props.children).toBe("0:30");

    act(() => {
      now += 60_000;
      jest.advanceTimersByTime(1_000);
    });
    expect(getByTestId("session-header-elapsed").props.children).toBe("1:30");
    expect(getByTestId("session-header")).toBeTruthy();
  });

  it("formats over-an-hour durations as h:mm:ss", () => {
    const { getByTestId } = renderWithTheme(
      <SessionHeader
        startedAt="2026-05-05T08:00:00.000Z"
        sessionName="Marathon"
        onMinimize={() => {}}
        onEnd={() => {}}
        clock={() => Date.parse("2026-05-05T10:01:05.000Z")}
      />,
    );
    expect(getByTestId("session-header-elapsed").props.children).toBe(
      "2:01:05",
    );
  });

  it("falls back to 0 elapsed when startedAt is unparsable", () => {
    const { getByTestId } = renderWithTheme(
      <SessionHeader
        startedAt="not-an-iso"
        sessionName="X"
        onMinimize={() => {}}
        onEnd={() => {}}
        clock={() => Date.parse("2026-05-05T10:00:00.000Z")}
      />,
    );
    expect(getByTestId("session-header-elapsed").props.children).toBe("0:00");
  });

  it("fires onMinimize from the chevron-down button and onEnd from the End pill", () => {
    const onMinimize = jest.fn();
    const onEnd = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionHeader
        startedAt="2026-05-05T10:00:00.000Z"
        sessionName="Push Day"
        onMinimize={onMinimize}
        onEnd={onEnd}
        clock={() => Date.parse("2026-05-05T10:00:00.000Z")}
      />,
    );
    fireEvent.press(getByTestId("session-minimize"));
    expect(onMinimize).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId("session-end"));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
