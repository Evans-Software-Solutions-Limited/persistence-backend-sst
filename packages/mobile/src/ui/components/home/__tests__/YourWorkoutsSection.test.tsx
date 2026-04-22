import { fireEvent } from "@testing-library/react-native";
import type { DashboardRecentWorkout } from "@/domain/models/dashboard";
import { YourWorkoutsSection } from "@/ui/components/home/YourWorkoutsSection";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

const workouts: DashboardRecentWorkout[] = [
  {
    id: "w1",
    name: "Push Day",
    description: "Chest + triceps",
    estimatedDurationMinutes: 45,
    createdBy: "user-1",
    isAssigned: false,
    assignedByType: null,
  },
  {
    id: "w2",
    name: "PT Programme",
    description: null,
    estimatedDurationMinutes: null,
    createdBy: "pt-1",
    isAssigned: true,
    assignedByType: "personal_trainer",
  },
];

describe("YourWorkoutsSection", () => {
  it("renders workouts with PT badge when assigned", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <YourWorkoutsSection
        workouts={workouts}
        onWorkoutPress={jest.fn()}
        onViewAllPress={jest.fn()}
      />,
    );
    expect(getByText("Push Day")).toBeTruthy();
    expect(getByTestId("workout-card-w2")).toBeTruthy();
  });

  it("routes onWorkoutPress with the tapped workout id", () => {
    const onWorkoutPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <YourWorkoutsSection
        workouts={workouts}
        onWorkoutPress={onWorkoutPress}
        onViewAllPress={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("workout-card-w1"));
    expect(onWorkoutPress).toHaveBeenCalledWith("w1");
  });

  it("fires onViewAllPress on See all tap", () => {
    const onViewAll = jest.fn();
    const { getByTestId } = renderWithTheme(
      <YourWorkoutsSection
        workouts={workouts}
        onWorkoutPress={jest.fn()}
        onViewAllPress={onViewAll}
      />,
    );
    fireEvent.press(getByTestId("your-workouts-view-all"));
    expect(onViewAll).toHaveBeenCalled();
  });

  it("renders the empty state when no workouts", () => {
    const { getByText } = renderWithTheme(
      <YourWorkoutsSection
        workouts={[]}
        onWorkoutPress={jest.fn()}
        onViewAllPress={jest.fn()}
      />,
    );
    expect(getByText("No workouts yet")).toBeTruthy();
  });

  it("renders physiotherapist badge for physio assignments", () => {
    const { getByText } = renderWithTheme(
      <YourWorkoutsSection
        workouts={[
          {
            id: "w3",
            name: "Physio plan",
            description: null,
            estimatedDurationMinutes: 30,
            createdBy: "physio-1",
            isAssigned: true,
            assignedByType: "physiotherapist",
          },
        ]}
        onWorkoutPress={jest.fn()}
        onViewAllPress={jest.fn()}
      />,
    );
    expect(getByText("Physio")).toBeTruthy();
  });
});
