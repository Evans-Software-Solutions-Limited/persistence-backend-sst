import { fireEvent, render, screen } from "@testing-library/react-native";
import { WorkoutLimitLockedPresenter } from "@/ui/presenters/WorkoutLimitLockedPresenter";

describe("WorkoutLimitLockedPresenter", () => {
  it("renders the count, limit, and how many to remove", () => {
    render(
      <WorkoutLimitLockedPresenter
        used={5}
        limit={3}
        onGoToWorkouts={jest.fn()}
        onUpgrade={jest.fn()}
      />,
    );
    expect(screen.getByText("You have 5 workouts")).toBeTruthy();
    expect(
      screen.getByText(
        "Free includes 3 — remove 2 workouts or upgrade to keep them all.",
      ),
    ).toBeTruthy();
  });

  it("singularises 'workout' when used === 1 and the over-by count is 1", () => {
    render(
      <WorkoutLimitLockedPresenter
        used={4}
        limit={3}
        onGoToWorkouts={jest.fn()}
        onUpgrade={jest.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Free includes 3 — remove 1 workout or upgrade to keep them all.",
      ),
    ).toBeTruthy();
  });

  it("never shows a negative over-by count when used <= limit (defensive floor at 0)", () => {
    render(
      <WorkoutLimitLockedPresenter
        used={3}
        limit={3}
        onGoToWorkouts={jest.fn()}
        onUpgrade={jest.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Free includes 3 — remove 0 workouts or upgrade to keep them all.",
      ),
    ).toBeTruthy();
  });

  it("singularises 'workout' in the title when used === 1 (defensive — unreachable via the real gate, which only shows this screen when over a limit ≥ 1)", () => {
    render(
      <WorkoutLimitLockedPresenter
        used={1}
        limit={0}
        onGoToWorkouts={jest.fn()}
        onUpgrade={jest.fn()}
      />,
    );
    expect(screen.getByText("You have 1 workout")).toBeTruthy();
  });

  it("calls onUpgrade when the Upgrade button is pressed", () => {
    const onUpgrade = jest.fn();
    render(
      <WorkoutLimitLockedPresenter
        used={5}
        limit={3}
        onGoToWorkouts={jest.fn()}
        onUpgrade={onUpgrade}
      />,
    );
    fireEvent.press(screen.getByTestId("workout-limit-locked-upgrade"));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it("calls onGoToWorkouts when the Go to My Workouts button is pressed", () => {
    const onGoToWorkouts = jest.fn();
    render(
      <WorkoutLimitLockedPresenter
        used={5}
        limit={3}
        onGoToWorkouts={onGoToWorkouts}
        onUpgrade={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByTestId("workout-limit-locked-go-to-workouts"));
    expect(onGoToWorkouts).toHaveBeenCalledTimes(1);
  });
});
