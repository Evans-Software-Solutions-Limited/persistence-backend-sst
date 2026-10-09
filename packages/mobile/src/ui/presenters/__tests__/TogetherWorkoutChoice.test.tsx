import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherWorkoutChoice } from "../TogetherWorkoutChoice";
it("makes the entire workout row selectable and shows only available metadata", () => {
  const choose = jest.fn();
  const r = renderWithTheme(
    <TogetherWorkoutChoice
      name="Push"
      exerciseCount={5}
      minutes={45}
      exerciseNames={["Bench press", "Incline press", "Cable fly", "Dips"]}
      onPress={choose}
    />,
  );
  fireEvent.press(r.getByLabelText("Choose Push"));
  expect(choose).toHaveBeenCalledTimes(1);
  expect(r.getByText("5 exercises · 45 min")).toBeTruthy();
  expect(r.getByText("Bench press · Incline press · Cable fly")).toBeTruthy();
  r.rerender(
    <TogetherWorkoutChoice
      name="Legs"
      exerciseCount={0}
      minutes={0}
      exerciseNames={[]}
      onPress={choose}
    />,
  );
  expect(r.getByText("0 exercises")).toBeTruthy();
  expect(r.queryByText(/min/)).toBeNull();
  r.rerender(
    <TogetherWorkoutChoice
      name="Legs"
      exerciseCount={2}
      minutes={-1}
      exerciseNames={[]}
      onPress={choose}
    />,
  );
  expect(r.getByText("2 exercises")).toBeTruthy();
});
