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
});
