import {
  fireEvent,
  renderWithTheme,
} from "../../../../../__tests__/test-utils";
import { YourTrainingPeekPresenter } from "../YourTrainingPeekPresenter";

describe("YourTrainingPeekPresenter", () => {
  it("renders the brag heading + streak + caption when on a streak", () => {
    const { getByText } = renderWithTheme(
      <YourTrainingPeekPresenter
        streakCount={23}
        streakUnit="day"
        sessionCaption="Last session: Upper Body · 45m"
      />,
    );
    expect(getByText("You're on a streak")).toBeTruthy();
    expect(getByText("23")).toBeTruthy();
    expect(getByText("day streak")).toBeTruthy();
    expect(getByText("Last session: Upper Body · 45m")).toBeTruthy();
  });

  it("drops the brag heading and caption when streak is 0 / no session", () => {
    const { getByText, getAllByText, queryByText } = renderWithTheme(
      <YourTrainingPeekPresenter streakCount={0} sessionCaption={null} />,
    );
    expect(queryByText("You're on a streak")).toBeNull();
    // "Your training" renders twice: the eyebrow + the (non-brag) heading.
    expect(getAllByText("Your training").length).toBeGreaterThanOrEqual(2);
    expect(getByText("0")).toBeTruthy();
    expect(queryByText(/Last session/)).toBeNull();
  });

  it("fires onStartSession from the play button", () => {
    const onStart = jest.fn();
    const { getByTestId } = renderWithTheme(
      <YourTrainingPeekPresenter
        streakCount={5}
        sessionCaption={null}
        onStartSession={onStart}
      />,
    );
    fireEvent.press(getByTestId("coach-training-play"));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
