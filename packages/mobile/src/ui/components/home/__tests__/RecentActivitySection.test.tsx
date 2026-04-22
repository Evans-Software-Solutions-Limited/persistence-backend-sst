import { fireEvent } from "@testing-library/react-native";
import type { DashboardRecentActivity } from "@/domain/models/dashboard";
import { RecentActivitySection } from "@/ui/components/home/RecentActivitySection";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

function at(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

const activities: DashboardRecentActivity[] = [
  {
    workoutSessionId: "s1",
    workoutId: "w1",
    workoutName: "Push Day",
    completedAt: at(30),
    durationSeconds: 3000,
  },
  {
    workoutSessionId: "s2",
    workoutId: null,
    workoutName: "Quick session",
    completedAt: at(60 * 25),
    durationSeconds: null,
  },
];

describe("RecentActivitySection", () => {
  it("renders all activities", () => {
    const { getByText } = renderWithTheme(
      <RecentActivitySection
        activities={activities}
        onActivityPress={jest.fn()}
      />,
    );
    expect(getByText("Push Day")).toBeTruthy();
    expect(getByText("Quick session")).toBeTruthy();
  });

  it("renders relative 'just now' for very recent activity", () => {
    const { getByText } = renderWithTheme(
      <RecentActivitySection
        activities={[
          {
            workoutSessionId: "x",
            workoutId: null,
            workoutName: "Fresh",
            completedAt: new Date().toISOString(),
            durationSeconds: 0,
          },
        ]}
        onActivityPress={jest.fn()}
      />,
    );
    expect(getByText(/just now/)).toBeTruthy();
  });

  it("fires onActivityPress with session id", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <RecentActivitySection
        activities={activities}
        onActivityPress={onPress}
      />,
    );
    fireEvent.press(getByTestId("recent-activity-s1"));
    expect(onPress).toHaveBeenCalledWith("s1");
  });

  it("renders empty state when no activities", () => {
    const { getByText } = renderWithTheme(
      <RecentActivitySection activities={[]} onActivityPress={jest.fn()} />,
    );
    expect(getByText("No recent activity")).toBeTruthy();
  });

  it("renders em-dash duration when durationSeconds is null", () => {
    const { getByText } = renderWithTheme(
      <RecentActivitySection
        activities={[activities[1]]}
        onActivityPress={jest.fn()}
      />,
    );
    expect(getByText("—")).toBeTruthy();
  });

  it("formats hour-range relative times", () => {
    const twoHoursAgo = at(60 * 2);
    const { getByText } = renderWithTheme(
      <RecentActivitySection
        activities={[
          {
            workoutSessionId: "h",
            workoutId: null,
            workoutName: "Morning",
            completedAt: twoHoursAgo,
            durationSeconds: 1800,
          },
        ]}
        onActivityPress={jest.fn()}
      />,
    );
    expect(getByText("2 hours ago")).toBeTruthy();
  });

  it("formats day-range relative times", () => {
    const twoDaysAgo = at(60 * 24 * 2);
    const { getByText } = renderWithTheme(
      <RecentActivitySection
        activities={[
          {
            workoutSessionId: "d",
            workoutId: null,
            workoutName: "Monday session",
            completedAt: twoDaysAgo,
            durationSeconds: 1800,
          },
        ]}
        onActivityPress={jest.fn()}
      />,
    );
    expect(getByText("2 days ago")).toBeTruthy();
  });

  it("formats 'yesterday' correctly", () => {
    const yesterday = at(60 * 24);
    const { getByText } = renderWithTheme(
      <RecentActivitySection
        activities={[
          {
            workoutSessionId: "y",
            workoutId: null,
            workoutName: "Yesterday's lift",
            completedAt: yesterday,
            durationSeconds: 1800,
          },
        ]}
        onActivityPress={jest.fn()}
      />,
    );
    expect(getByText("yesterday")).toBeTruthy();
  });

  it("handles unparseable completedAt gracefully", () => {
    const { getByTestId } = renderWithTheme(
      <RecentActivitySection
        activities={[
          {
            workoutSessionId: "bad",
            workoutId: null,
            workoutName: "Broken",
            completedAt: "not-a-date",
            durationSeconds: null,
          },
        ]}
        onActivityPress={jest.fn()}
      />,
    );
    expect(getByTestId("recent-activity-bad")).toBeTruthy();
  });
});
