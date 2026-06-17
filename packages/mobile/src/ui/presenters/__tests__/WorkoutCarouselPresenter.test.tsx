import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  WorkoutCarouselPresenter,
  type WorkoutCarouselItem,
} from "../WorkoutCarouselPresenter";

const ITEMS: WorkoutCarouselItem[] = [
  { id: "w1", title: "Push Day", mins: 45, sub: "Chest + tris", chips: [] },
  { id: "w2", title: "Pull Day", mins: 50, sub: "Back + bis", chips: [] },
];

describe("WorkoutCarouselPresenter", () => {
  it("renders a card per workout, first promoted, and fires onOpenWorkout", () => {
    const onOpenWorkout = jest.fn();
    const { getByTestId } = renderWithTheme(
      <WorkoutCarouselPresenter
        workouts={ITEMS}
        onOpenWorkout={onOpenWorkout}
      />,
    );
    expect(getByTestId("workout-carousel")).toBeTruthy();
    fireEvent.press(getByTestId("workout-carousel-card-1"));
    expect(onOpenWorkout).toHaveBeenCalledWith("w2");
  });

  it("shows a skeleton while loading with no cached workouts", () => {
    const { getByTestId } = renderWithTheme(
      <WorkoutCarouselPresenter
        workouts={[]}
        isLoading
        onOpenWorkout={jest.fn()}
      />,
    );
    expect(getByTestId("workout-carousel-loading")).toBeTruthy();
    expect(getByTestId("workout-carousel-skeleton")).toBeTruthy();
  });

  it("shows an empty state when there are no workouts and not loading", () => {
    const { getByTestId } = renderWithTheme(
      <WorkoutCarouselPresenter workouts={[]} onOpenWorkout={jest.fn()} />,
    );
    expect(getByTestId("workout-carousel-empty")).toBeTruthy();
  });
});
