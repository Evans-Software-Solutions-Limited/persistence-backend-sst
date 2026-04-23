import { fireEvent } from "@testing-library/react-native";
import { YourWorkoutsSection } from "@/ui/components/home/YourWorkoutsSection";
import type { WorkoutCardWorkout } from "@/ui/components/home/WorkoutCard";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

jest.mock("react-native-reanimated-carousel", () => {
  const React = require("react");
  const { View } = require("react-native");
  // Replace the real Carousel with a simple horizontal View that just
  // renders each item in turn — avoids pulling in reanimated's native
  // module under jest.
  return {
    __esModule: true,
    default: ({ data, renderItem }: any) =>
      React.createElement(
        View,
        { testID: "carousel-mock" },
        data.map((item: any, index: number) =>
          React.createElement(
            View,
            { key: item.id ?? index },
            renderItem({ item, index, animationValue: { value: 0 } }),
          ),
        ),
      ),
  };
});

const workout = (
  overrides: Partial<WorkoutCardWorkout> = {},
): WorkoutCardWorkout => ({
  id: "w-1",
  name: "Push Day",
  description: "Chest + shoulders + triceps",
  estimated_duration_minutes: 45,
  exercises: [],
  targeted_muscles: [],
  is_assigned: false,
  assigned_by_type: null,
  created_by: "user-1",
  ...overrides,
});

describe("YourWorkoutsSection", () => {
  const base = {
    onWorkoutPress: jest.fn(),
    onWorkoutStart: jest.fn(),
    onViewAllPress: jest.fn(),
  };

  it("returns null when workouts is empty", () => {
    const { queryByTestId } = renderWithTheme(
      <YourWorkoutsSection {...base} workouts={[]} />,
    );
    expect(queryByTestId("your-workouts-section")).toBeNull();
  });

  it("renders the section + carousel mock for at least one workout", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <YourWorkoutsSection {...base} workouts={[workout()]} />,
    );
    expect(getByTestId("your-workouts-section")).toBeTruthy();
    expect(getByTestId("carousel-mock")).toBeTruthy();
    expect(getByText("Push Day")).toBeTruthy();
    expect(getByText("Your Workouts")).toBeTruthy();
  });

  it("fires onViewAllPress from the header link", () => {
    const onViewAllPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <YourWorkoutsSection
        {...base}
        workouts={[workout()]}
        onViewAllPress={onViewAllPress}
      />,
    );
    fireEvent.press(getByTestId("your-workouts-view-all"));
    expect(onViewAllPress).toHaveBeenCalled();
  });
});
