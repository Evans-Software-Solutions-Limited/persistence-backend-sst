/**
 * SessionSummaryPresenter tests — Phase 3b legacy port.
 *
 * The presenter consumes a pre-merged display shape from
 * `SessionSummaryContainer` (server data wins for `personalRecords`
 * + `workoutsThisMonth`; local fills `totalVolume`). These tests
 * exercise the rendering layer directly with both
 * "pre-server-response" (`workoutsThisMonth: null`, PRs without
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
  workoutsThisMonth: null as number | null,
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

  it("subtitle shows N workouts this month and pluralises correctly post-server", () => {
    const { getByText, rerender } = renderWithTheme(
      <SessionSummaryPresenter {...baseProps} workoutsThisMonth={1} />,
    );
    expect(
      getByText(
        "You've completed 1 workout this month. Keep the momentum going!",
      ),
    ).toBeTruthy();

    rerender(<SessionSummaryPresenter {...baseProps} workoutsThisMonth={7} />);
    expect(
      getByText(
        "You've completed 7 workouts this month. Keep the momentum going!",
      ),
    ).toBeTruthy();
  });

  it("subtitle falls back to 'Keep the momentum going!' pre-server (workoutsThisMonth=null)", () => {
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter {...baseProps} workoutsThisMonth={null} />,
    );
    expect(getByText("Keep the momentum going!")).toBeTruthy();
  });

  it("Workouts this month tile shows an em-dash pre-server, the real count post-server", () => {
    const { getByText, rerender, queryByText } = renderWithTheme(
      <SessionSummaryPresenter {...baseProps} workoutsThisMonth={null} />,
    );
    expect(getByText("—")).toBeTruthy();

    rerender(<SessionSummaryPresenter {...baseProps} workoutsThisMonth={12} />);
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

  it("best_time + longest_distance PRs render with seconds + metres units (Inspector Brad PR #62 regression — no kg fallthrough)", () => {
    // Pre-fix, `formatPRValue` had an "everything-else → kg" branch,
    // so a 45-second time PR rendered as "45.0 kg". Whitelist-style
    // switch with no default fixes that. Server PR detection
    // doesn't emit these record types today, but the type union
    // accepts them and a future enum migration could unblock the
    // server side — the presenter is now honest regardless.
    const timePR: SummaryPersonalRecord = {
      exerciseId: "ex-sprint",
      exerciseName: "100m Sprint",
      recordType: "best_time",
      newValue: 12.4,
      previousValue: 14.1,
    };
    const distancePR: SummaryPersonalRecord = {
      exerciseId: "ex-run",
      exerciseName: "Run",
      recordType: "longest_distance",
      newValue: 5200,
      previousValue: 4800,
    };
    const { getByText, queryByText, rerender } = renderWithTheme(
      <SessionSummaryPresenter
        {...baseProps}
        recordsHit={1}
        personalRecords={[timePR]}
      />,
    );
    expect(getByText("12.4 s")).toBeTruthy();
    expect(getByText("14.1 s")).toBeTruthy();
    expect(queryByText("12.4 kg")).toBeNull();
    expect(queryByText("14.1 kg")).toBeNull();

    rerender(
      <SessionSummaryPresenter
        {...baseProps}
        recordsHit={1}
        personalRecords={[distancePR]}
      />,
    );
    expect(getByText("5200.0 m")).toBeTruthy();
    expect(getByText("4800.0 m")).toBeTruthy();
    expect(queryByText("5200.0 kg")).toBeNull();
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

  it("weightUnit='lb' converts the Total Volume tile + weight-type PR values", () => {
    const pr: SummaryPersonalRecord = {
      exerciseId: "ex-bench",
      exerciseName: "Bench Press",
      recordType: "1rm",
      newValue: 100,
      previousValue: null,
    };
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter
        {...baseProps}
        totalVolume={500}
        recordsHit={1}
        personalRecords={[pr]}
        weightUnit="lb"
      />,
    );
    // 500 kg -> 1102.3 lb rounded to a whole number by formatVolume's lb branch.
    expect(getByText("1,102 lb")).toBeTruthy();
    // 100 kg -> 220.5 lb via formatWeight (1dp).
    expect(getByText("220.5 lb")).toBeTruthy();
  });

  it("weightUnit='lb' does not affect max_reps/best_time/longest_distance PR units", () => {
    const pr: SummaryPersonalRecord = {
      exerciseId: "ex-row",
      exerciseName: "Row",
      recordType: "max_reps",
      newValue: 18,
      previousValue: null,
    };
    const { getByText } = renderWithTheme(
      <SessionSummaryPresenter
        {...baseProps}
        recordsHit={1}
        personalRecords={[pr]}
        weightUnit="lb"
      />,
    );
    expect(getByText("18 reps")).toBeTruthy();
  });
});
