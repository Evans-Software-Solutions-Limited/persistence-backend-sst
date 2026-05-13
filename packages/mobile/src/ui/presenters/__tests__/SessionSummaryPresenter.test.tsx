/**
 * SessionSummaryPresenter tests — Phase 3b legacy port.
 *
 * The presenter consumes a pre-merged display shape from
 * `SessionSummaryContainer` (server data wins for `personalRecords`
 * + `totalWorkoutsCompleted`; local fills `totalVolume`). These tests
 * exercise the rendering layer directly with both
 * "pre-server-response" (`totalWorkoutsCompleted: null`, PRs without
 * `previousValue`) and "post-server-response" (real count, PRs with
 * `previousValue`) prop shapes.
 */

import React from "react";
import { SessionSummaryPresenter } from "../SessionSummaryPresenter";
import type { SummaryPersonalRecord } from "@/ui/containers/SessionSummaryContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const handlers = {
  onSave: jest.fn(),
  onClose: jest.fn(),
};

const baseProps = {
  totalVolume: 0,
  recordsHit: 0,
  totalWorkoutsCompleted: null as number | null,
  personalRecords: [] as SummaryPersonalRecord[],
  ...handlers,
};

describe("SessionSummaryPresenter — Phase 3b legacy port", () => {
  beforeEach(() => {
    handlers.onSave.mockClear();
    handlers.onClose.mockClear();
  });

  it("renders the legacy 'Workout Complete!' title + close button", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <SessionSummaryPresenter {...baseProps} />,
    );
    expect(getByText("Workout Complete!")).toBeTruthy();
    expect(getByTestId("session-summary-close")).toBeTruthy();
  });

  it("subtitle shows N total workouts and pluralises correctly post-server", () => {
    const { getByText, rerender } = renderWithTheme(
      <SessionSummaryPresenter {...baseProps} totalWorkoutsCompleted={1} />,
    );
    expect(
      getByText("You've completed 1 total workout. Keep the momentum going!"),
    ).toBeTruthy();

    rerender(
      <SessionSummaryPresenter {...baseProps} totalWorkoutsCompleted={7} />,
    );
    expect(
      getByText("You've completed 7 total workouts. Keep the momentum going!"),
    ).toBeTruthy();
  });

  it("subtitle falls back to 'Keep the momentum going!' pre-server (totalWorkoutsCompleted=null)", () => {
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter {...baseProps} totalWorkoutsCompleted={null} />,
    );
    expect(getByText("Keep the momentum going!")).toBeTruthy();
  });

  it("Workouts Completed tile shows an em-dash pre-server, the real count post-server", () => {
    const { getByText, rerender, queryByText } = renderWithTheme(
      <SessionSummaryPresenter {...baseProps} totalWorkoutsCompleted={null} />,
    );
    expect(getByText("—")).toBeTruthy();

    rerender(
      <SessionSummaryPresenter {...baseProps} totalWorkoutsCompleted={12} />,
    );
    // Em-dash is replaced; "12" appears as the tile's value.
    expect(queryByText("—")).toBeNull();
    expect(getByText("12")).toBeTruthy();
  });

  it("Total Volume tile renders the legacy formatter (tonnes when ≥ 1000kg)", () => {
    const { getByText, rerender } = renderWithTheme(
      <SessionSummaryPresenter {...baseProps} totalVolume={2500} />,
    );
    expect(getByText("2.5 t")).toBeTruthy();

    rerender(<SessionSummaryPresenter {...baseProps} totalVolume={500} />);
    expect(getByText("500 kg")).toBeTruthy();

    rerender(<SessionSummaryPresenter {...baseProps} totalVolume={0} />);
    expect(getByText("0 kg")).toBeTruthy();
  });

  it("PR section header is the legacy 'Personal Records Hit! 🏆'", () => {
    const pr: SummaryPersonalRecord = {
      exerciseId: "ex-bench",
      exerciseName: "Bench Press",
      recordType: "1rm",
      newValue: 137.4,
      previousValue: 120,
    };
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter
        {...baseProps}
        recordsHit={1}
        personalRecords={[pr]}
      />,
    );
    expect(getByText("Personal Records Hit! 🏆")).toBeTruthy();
  });

  it("renders PR card with previous→new arrow + strikethrough when previousValue is set", () => {
    const pr: SummaryPersonalRecord = {
      exerciseId: "ex-bench",
      exerciseName: "Bench Press",
      recordType: "1rm",
      newValue: 137.4,
      previousValue: 120,
    };
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter
        {...baseProps}
        recordsHit={1}
        personalRecords={[pr]}
      />,
    );
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByText("1 Rep Max")).toBeTruthy();
    expect(getByText("120.0 kg")).toBeTruthy();
    expect(getByText("→")).toBeTruthy();
    expect(getByText("137.4 kg")).toBeTruthy();
  });

  it("renders PR card without the arrow when previousValue is null (pre-server local prediction)", () => {
    const pr: SummaryPersonalRecord = {
      exerciseId: "ex-bench",
      exerciseName: "Bench Press",
      recordType: "1rm",
      newValue: 137.4,
      previousValue: null,
    };
    const { getByText, queryByText } = renderWithTheme(
      <SessionSummaryPresenter
        {...baseProps}
        recordsHit={1}
        personalRecords={[pr]}
      />,
    );
    expect(getByText("137.4 kg")).toBeTruthy();
    expect(queryByText("→")).toBeNull();
  });

  it("max_volume PR renders with kg suffix (Phase 3b broadened detection)", () => {
    const pr: SummaryPersonalRecord = {
      exerciseId: "ex-bench",
      exerciseName: "Bench Press",
      recordType: "max_volume",
      newValue: 800,
      previousValue: 600,
    };
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter
        {...baseProps}
        recordsHit={1}
        personalRecords={[pr]}
      />,
    );
    expect(getByText("Max Volume")).toBeTruthy();
    expect(getByText("800.0 kg")).toBeTruthy();
    expect(getByText("600.0 kg")).toBeTruthy();
  });

  it("max_reps PR renders with reps suffix (dimensionless count)", () => {
    const pr: SummaryPersonalRecord = {
      exerciseId: "ex-row",
      exerciseName: "Row",
      recordType: "max_reps",
      newValue: 18,
      previousValue: null,
    };
    const { getByText, queryByText } = renderWithTheme(
      <SessionSummaryPresenter
        {...baseProps}
        recordsHit={1}
        personalRecords={[pr]}
      />,
    );
    expect(getByText("Max Reps")).toBeTruthy();
    expect(getByText("18 reps")).toBeTruthy();
    expect(queryByText("18 kg")).toBeNull();
  });

  it("hides the PR section entirely when personalRecords is empty", () => {
    const { queryByTestId } = renderWithTheme(
      <SessionSummaryPresenter {...baseProps} recordsHit={0} />,
    );
    expect(queryByTestId("summary-pr-section")).toBeNull();
  });

  it("Continue button always reads 'Continue' (no View Achievements gate in V2)", () => {
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter {...baseProps} />,
    );
    expect(getByText("Continue")).toBeTruthy();
  });
});
