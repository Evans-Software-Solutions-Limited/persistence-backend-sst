import React from "react";
import { ExerciseProgress } from "../ExerciseProgress";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

describe("ExerciseProgress", () => {
  it("renders 'X / Y' from props", () => {
    const { getByText } = renderWithTheme(
      <ExerciseProgress setsCompleted={2} totalSets={3} />,
    );
    expect(getByText("2 / 3")).toBeTruthy();
  });

  it("highlights when fully complete", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseProgress setsCompleted={3} totalSets={3} />,
    );
    const pill = getByTestId("exercise-progress");
    expect(pill).toBeTruthy();
  });

  it("shows 0 / 0 with no highlight when no sets exist", () => {
    const { getByText } = renderWithTheme(
      <ExerciseProgress setsCompleted={0} totalSets={0} />,
    );
    expect(getByText("0 / 0")).toBeTruthy();
  });
});
