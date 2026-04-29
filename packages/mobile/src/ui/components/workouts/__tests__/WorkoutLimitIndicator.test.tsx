import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { WorkoutLimitIndicator } from "@/ui/components/workouts/WorkoutLimitIndicator";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("WorkoutLimitIndicator", () => {
  it("renders the quota copy + upgrade CTA when role is loaded", () => {
    const onUpgrade = jest.fn();
    const { getByText } = renderWithTheme(
      <WorkoutLimitIndicator
        userWorkoutLimit={3}
        isLoadingUserRole={false}
        onUpgrade={onUpgrade}
      />,
    );
    expect(getByText("Workout Limit Reached")).toBeTruthy();
    expect(
      getByText(
        "You've used all 3 free workout templates. Upgrade to create more!",
      ),
    ).toBeTruthy();
    fireEvent.press(getByText("Upgrade Now"));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("renders the loading copy variant when isLoadingUserRole is true", () => {
    const { getByText } = renderWithTheme(
      <WorkoutLimitIndicator
        userWorkoutLimit={undefined}
        isLoadingUserRole={true}
        onUpgrade={() => {}}
      />,
    );
    expect(getByText("Loading workout limit...")).toBeTruthy();
  });
});
