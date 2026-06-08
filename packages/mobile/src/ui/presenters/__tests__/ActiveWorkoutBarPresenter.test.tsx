import { fireEvent, renderWithTheme } from "../../../../__tests__/test-utils";
import {
  ActiveWorkoutBarPresenter,
  formatBarElapsed,
} from "../ActiveWorkoutBarPresenter";

/**
 * <ActiveWorkoutBarPresenter> tests.
 *
 * Spec: specs/05-active-session/requirements.md STORY-006 (AC 6.3, 6.4, 6.7)
 *       tasks.md T-05.2.5
 */

describe("formatBarElapsed", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [65, "1:05"],
    [600, "10:00"],
    [3661, "61:01"],
  ])("formats %i seconds as %s", (input, expected) => {
    expect(formatBarElapsed(input)).toBe(expected);
  });

  it("clamps negatives to 0:00", () => {
    expect(formatBarElapsed(-10)).toBe("0:00");
  });
});

describe("ActiveWorkoutBarPresenter", () => {
  it("renders the workout name + mono timer", () => {
    const { getByTestId } = renderWithTheme(
      <ActiveWorkoutBarPresenter
        workoutName="Upper Body"
        elapsedSeconds={65}
        onPress={jest.fn()}
      />,
    );
    expect(getByTestId("active-workout-bar-title").props.children).toBe(
      "Upper Body",
    );
    expect(getByTestId("active-workout-bar-timer").props.children).toBe("1:05");
    // pulse dot present
    expect(getByTestId("active-workout-bar-pulse")).toBeTruthy();
  });

  it("renders the timer in the mono family with tabular figures", () => {
    const { getByTestId } = renderWithTheme(
      <ActiveWorkoutBarPresenter
        workoutName="X"
        elapsedSeconds={0}
        onPress={jest.fn()}
      />,
    );
    const timer = getByTestId("active-workout-bar-timer");
    expect(JSON.stringify(timer.props)).toContain("tabular-nums");
  });

  it("fires onPress when tapped", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ActiveWorkoutBarPresenter
        workoutName="X"
        elapsedSeconds={0}
        onPress={onPress}
      />,
    );
    fireEvent.press(getByTestId("active-workout-bar"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("fires onLongPress for the end escape hatch", () => {
    const onLongPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ActiveWorkoutBarPresenter
        workoutName="X"
        elapsedSeconds={0}
        onPress={jest.fn()}
        onLongPress={onLongPress}
      />,
    );
    fireEvent(getByTestId("active-workout-bar"), "longPress");
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("renders without animation when reduced motion is forced", () => {
    const { getByTestId } = renderWithTheme(
      <ActiveWorkoutBarPresenter
        workoutName="X"
        elapsedSeconds={0}
        onPress={jest.fn()}
        reduceMotionOverride={true}
      />,
    );
    // Still renders the (static) pulse dot.
    expect(getByTestId("active-workout-bar-pulse")).toBeTruthy();
  });
});
