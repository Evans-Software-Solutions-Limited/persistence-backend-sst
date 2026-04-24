import { fireEvent } from "@testing-library/react-native";
import { RecentActivitySection } from "@/ui/components/home/RecentActivitySection";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("RecentActivitySection", () => {
  const activity = {
    workout_session_id: "s-1",
    workout_name: "Push Day",
    completed_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  };

  it("returns null when activities is empty", () => {
    const { queryByTestId } = renderWithTheme(
      <RecentActivitySection activities={[]} />,
    );
    expect(queryByTestId("recent-activity-section")).toBeNull();
  });

  it("renders each row with name + relative timestamp", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <RecentActivitySection activities={[activity]} />,
    );
    expect(getByTestId("recent-activity-section")).toBeTruthy();
    expect(getByText("Push Day")).toBeTruthy();
    expect(getByText(/30 min ago/)).toBeTruthy();
  });

  it("fires onActivityPress with the session id when provided", () => {
    const onActivityPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <RecentActivitySection
        activities={[activity]}
        onActivityPress={onActivityPress}
      />,
    );
    fireEvent.press(getByTestId("recent-activity-s-1"));
    expect(onActivityPress).toHaveBeenCalledWith("s-1");
  });

  it("renders non-pressable rows when onActivityPress is omitted", () => {
    const { getByTestId } = renderWithTheme(
      <RecentActivitySection activities={[activity]} />,
    );
    expect(getByTestId("recent-activity-s-1")).toBeTruthy();
  });

  it("renders multiple activities in order", () => {
    const { getByTestId } = renderWithTheme(
      <RecentActivitySection
        activities={[
          activity,
          {
            workout_session_id: "s-2",
            workout_name: "Pull Day",
            completed_at: new Date(Date.now() - 120 * 60_000).toISOString(),
          },
        ]}
      />,
    );
    expect(getByTestId("recent-activity-s-1")).toBeTruthy();
    expect(getByTestId("recent-activity-s-2")).toBeTruthy();
  });

  it("formats an hour-relative timestamp", () => {
    const { getByText } = renderWithTheme(
      <RecentActivitySection
        activities={[
          {
            workout_session_id: "s-hr",
            workout_name: "Leg Day",
            completed_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
          },
        ]}
      />,
    );
    expect(getByText(/2 hours ago/)).toBeTruthy();
  });

  it("formats a day-relative timestamp", () => {
    const { getByText } = renderWithTheme(
      <RecentActivitySection
        activities={[
          {
            workout_session_id: "s-d",
            workout_name: "Push Day",
            completed_at: new Date(
              Date.now() - 3 * 24 * 60 * 60_000,
            ).toISOString(),
          },
        ]}
      />,
    );
    expect(getByText(/3 days ago/)).toBeTruthy();
  });

  it("formats yesterday as 'yesterday'", () => {
    const { getByText } = renderWithTheme(
      <RecentActivitySection
        activities={[
          {
            workout_session_id: "s-y",
            workout_name: "Mobility",
            completed_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
          },
        ]}
      />,
    );
    expect(getByText(/yesterday/)).toBeTruthy();
  });

  it("returns empty-string relative time for unparseable dates", () => {
    const { queryByText } = renderWithTheme(
      <RecentActivitySection
        activities={[
          {
            workout_session_id: "s-bad",
            workout_name: "Mystery",
            completed_at: "not-a-date",
          },
        ]}
      />,
    );
    // Name still renders, timestamp is an empty string (no min/hour/day label).
    expect(queryByText(/min ago|hour ago|hours ago|days ago/)).toBeNull();
  });
});
