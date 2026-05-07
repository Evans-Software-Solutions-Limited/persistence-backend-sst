import React from "react";
import { SessionSummaryPresenter } from "../SessionSummaryPresenter";
import type { PersonalRecord } from "@/domain/models/record";
import type { SessionSummary } from "@/domain/models/session";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const baseSummary: SessionSummary = {
  duration: 0,
  totalVolume: 0,
  exercisesCompleted: 0,
  totalExercises: 0,
  setsCompleted: 0,
  totalSets: 0,
  personalRecords: [],
};

const handlers = {
  onSave: jest.fn(),
  onClose: jest.fn(),
};

describe("SessionSummaryPresenter", () => {
  it("formats sub-hour durations as `Xm`", () => {
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter
        summary={{ ...baseSummary, duration: 25 * 60 }}
        {...handlers}
      />,
    );
    expect(getByText("25m")).toBeTruthy();
  });

  it("formats hour-plus durations as `Hh Mm`", () => {
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter
        summary={{ ...baseSummary, duration: 3600 + 5 * 60 }}
        {...handlers}
      />,
    );
    expect(getByText("1h 5m")).toBeTruthy();
  });

  it("formats large volume as tonnes", () => {
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter
        summary={{ ...baseSummary, totalVolume: 2500 }}
        {...handlers}
      />,
    );
    expect(getByText("2.5 t")).toBeTruthy();
  });

  it("formats a 1rm PR with kg suffix and 1dp value", () => {
    const pr: PersonalRecord = {
      id: "pr-1",
      userId: "user-1",
      exerciseId: "ex-bench",
      exerciseName: "Bench Press",
      recordType: "1rm",
      value: 137.4,
      achievedAt: "2026-05-05T10:30:00.000Z",
      sessionId: "local-1",
      setId: "set-1",
    };
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter
        summary={{ ...baseSummary, personalRecords: [pr] }}
        {...handlers}
      />,
    );
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByText("137.4 kg")).toBeTruthy();
    expect(getByText("1 Rep Max")).toBeTruthy();
  });

  it("formats a non-1rm PR without the kg suffix", () => {
    const pr: PersonalRecord = {
      id: "pr-2",
      userId: "user-1",
      exerciseId: "ex-row",
      exerciseName: "Row",
      recordType: "max_reps",
      value: 18,
      achievedAt: "2026-05-05T10:30:00.000Z",
      sessionId: "local-1",
      setId: null,
    };
    const { getByText, queryByText } = renderWithTheme(
      <SessionSummaryPresenter
        summary={{ ...baseSummary, personalRecords: [pr] }}
        {...handlers}
      />,
    );
    expect(getByText("Max Reps")).toBeTruthy();
    expect(getByText("18.0")).toBeTruthy();
    expect(queryByText("18.0 kg")).toBeNull();
  });
});
