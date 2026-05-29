import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  WorkoutCarouselCard,
  workoutCarouselCardPressStyle,
} from "../WorkoutCarouselCard";

describe("WorkoutCarouselCard", () => {
  it("renders title, sub, mins pill, and chips", () => {
    const { getByText } = renderWithTheme(
      <WorkoutCarouselCard
        title="Push Day"
        mins={45}
        sub="Chest, shoulders, triceps"
        chips={["Push", "Hypertrophy"]}
      />,
    );
    expect(getByText("Push Day")).toBeTruthy();
    expect(getByText("Chest, shoulders, triceps")).toBeTruthy();
    expect(getByText("45M")).toBeTruthy();
    expect(getByText("Push")).toBeTruthy();
    expect(getByText("Hypertrophy")).toBeTruthy();
  });

  it("renders the primary gradient variant", () => {
    const { getByText } = renderWithTheme(
      <WorkoutCarouselCard
        title="Featured"
        mins={30}
        sub="Promoted"
        chips={[]}
        primary
      />,
    );
    expect(getByText("Featured")).toBeTruthy();
  });

  it("fires onPress when tapped", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <WorkoutCarouselCard
        title="Pull Day"
        mins={50}
        sub="Back, biceps"
        chips={["Pull"]}
        onPress={onPress}
        testID="wcc"
      />,
    );
    expect(getByTestId("wcc").props.accessibilityLabel).toBe(
      "Pull Day, 50 minutes",
    );
    fireEvent.press(getByTestId("wcc"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("renders a non-pressable card without onPress", () => {
    const { getByTestId } = renderWithTheme(
      <WorkoutCarouselCard
        title="Static"
        mins={20}
        sub="x"
        chips={[]}
        testID="wcc"
      />,
    );
    expect(getByTestId("wcc").props.accessibilityRole).toBeUndefined();
  });

  it("renders skeletons when loading (no title, not pressable)", () => {
    const { getByTestId, queryByText } = renderWithTheme(
      <WorkoutCarouselCard
        title="Push Day"
        mins={45}
        sub="x"
        chips={[]}
        loading
        onPress={() => undefined}
        testID="wcc"
      />,
    );
    expect(getByTestId("wcc-skeleton")).toBeTruthy();
    expect(queryByText("Push Day")).toBeNull();
    expect(getByTestId("wcc").props.accessibilityRole).toBeUndefined();
  });

  it("press style fixes the 260pt width + toggles opacity", () => {
    expect(workoutCarouselCardPressStyle({ pressed: true })).toEqual({
      opacity: 0.85,
      width: 260,
    });
    expect(workoutCarouselCardPressStyle({ pressed: false })).toEqual({
      opacity: 1,
      width: 260,
    });
  });
});
