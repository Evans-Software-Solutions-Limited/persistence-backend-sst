import {
  fireEvent,
  renderWithTheme,
} from "../../../../../__tests__/test-utils";
import { BusinessStatsPresenter } from "../BusinessStatsPresenter";
import {
  makeCoachOverview,
  makeEmptyCoachOverview,
} from "./coachOverview.fixture";

describe("BusinessStatsPresenter", () => {
  it("renders the section header + all four stat values", () => {
    const stats = makeCoachOverview().businessStats;
    const { getByText, getByTestId } = renderWithTheme(
      <BusinessStatsPresenter
        stats={stats}
        monthLabel="March"
        onInvite={jest.fn()}
      />,
    );
    expect(getByText("Your business")).toBeTruthy();
    expect(getByText("This month")).toBeTruthy();
    // active clients
    expect(getByText("8")).toBeTruthy();
    expect(getByText("+2")).toBeTruthy();
    expect(getByText("2 of 10 slots open")).toBeTruthy();
    // adherence with % suffix split across nodes; caption derives last-mo
    expect(getByText("up from 78% last mo")).toBeTruthy();
    // PRs
    expect(getByText("14")).toBeTruthy();
    expect(getByText("across 6 clients")).toBeTruthy();
    // retention
    expect(getByText("1 churn this Q")).toBeTruthy();
    expect(getByTestId("coach-invite-btn")).toBeTruthy();
  });

  it("fires onInvite when the Invite button is pressed", () => {
    const onInvite = jest.fn();
    const { getByTestId } = renderWithTheme(
      <BusinessStatsPresenter
        stats={makeCoachOverview().businessStats}
        monthLabel="March"
        onInvite={onInvite}
      />,
    );
    fireEvent.press(getByTestId("coach-invite-btn"));
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it("renders em-dash placeholders for null metrics and drops captions", () => {
    const stats = makeEmptyCoachOverview().businessStats;
    const { getAllByText, queryByText } = renderWithTheme(
      <BusinessStatsPresenter
        stats={stats}
        monthLabel="March"
        onInvite={jest.fn()}
      />,
    );
    // avgAdherence + retentionPct both null → two em-dashes
    expect(getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // no slot caption (null slotsTotal), no churn caption (0)
    expect(queryByText(/slots open/)).toBeNull();
    expect(queryByText(/churn this Q/)).toBeNull();
    // no "+N" badge when zero new clients
    expect(queryByText(/^\+/)).toBeNull();
  });
});
