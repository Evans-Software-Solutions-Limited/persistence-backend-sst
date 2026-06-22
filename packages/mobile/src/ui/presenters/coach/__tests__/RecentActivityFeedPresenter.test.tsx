import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  RecentActivityFeedPresenter,
  eventVisual,
  relativeTime,
} from "../RecentActivityFeedPresenter";
import type { RecentActivityEvent } from "@/domain/models/coachOverview";

function ev(over: Partial<RecentActivityEvent>): RecentActivityEvent {
  return {
    type: "session_completed",
    clientId: "c1",
    clientName: "Emma Chen",
    clientInitials: "EC",
    payload: {},
    occurredAt: "2026-06-21T07:00:00.000Z",
    ...over,
  };
}

describe("eventVisual", () => {
  it("maps pr_achieved to a record-type sentence", () => {
    const v = eventVisual(
      ev({ type: "pr_achieved", payload: { recordType: "1rm" } }),
    );
    expect(v.tone).toBe("gold");
    expect(v.text).toBe("hit a new 1rm PR");
  });

  it("falls back when pr_achieved has no record type", () => {
    const v = eventVisual(ev({ type: "pr_achieved", payload: {} }));
    expect(v.text).toBe("hit a new personal record");
  });

  it("maps session_completed with a session name", () => {
    const v = eventVisual(
      ev({ type: "session_completed", payload: { sessionName: "Push Day" } }),
    );
    expect(v.tone).toBe("success");
    expect(v.text).toBe("completed Push Day");
  });

  it("falls back when session_completed has no name", () => {
    const v = eventVisual(ev({ type: "session_completed", payload: {} }));
    expect(v.text).toBe("completed a session");
  });

  it("maps missed_day to an ember miss", () => {
    const v = eventVisual(ev({ type: "missed_day", payload: {} }));
    expect(v.tone).toBe("ember");
    expect(v.text).toBe("missed a scheduled session");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-21T10:00:00.000Z").getTime();
  it.each([
    ["2026-06-21T10:00:00.000Z", "now"],
    ["2026-06-21T09:45:00.000Z", "15m"],
    ["2026-06-21T08:00:00.000Z", "2h"],
    ["2026-06-20T10:00:00.000Z", "1d"],
  ])("formats %s as %s", (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });

  it("returns empty for an unparseable timestamp", () => {
    expect(relativeTime("not-a-date", now)).toBe("");
  });
});

describe("RecentActivityFeedPresenter", () => {
  it("renders a row per event with the client name + time", () => {
    const now = new Date("2026-06-21T10:00:00.000Z").getTime();
    const { getByText } = renderWithTheme(
      <RecentActivityFeedPresenter
        now={now}
        events={[
          ev({
            type: "pr_achieved",
            clientName: "Priya Shah",
            payload: { recordType: "1rm" },
            occurredAt: "2026-06-21T09:45:00.000Z",
          }),
        ]}
      />,
    );
    expect(getByText("Recent")).toBeTruthy();
    expect(getByText("Priya Shah")).toBeTruthy();
    expect(getByText("15m")).toBeTruthy();
  });

  it("renders the empty placeholder for no events", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <RecentActivityFeedPresenter events={[]} />,
    );
    expect(getByTestId("coach-activity-empty")).toBeTruthy();
    expect(getByText("No recent activity")).toBeTruthy();
  });

  it("falls back to 'A client' when the name is blank", () => {
    const { getByText } = renderWithTheme(
      <RecentActivityFeedPresenter
        events={[ev({ clientName: "", payload: {} })]}
      />,
    );
    expect(getByText("A client")).toBeTruthy();
  });
});
