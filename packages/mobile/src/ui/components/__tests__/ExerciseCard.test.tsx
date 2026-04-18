import { fireEvent } from "@testing-library/react-native";
import type { Exercise } from "@/domain/models/exercise";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ExerciseCard } from "../ExerciseCard";

const baseExercise: Exercise = {
  id: "ex-1",
  name: "Barbell Back Squat",
  description: "Compound lower-body movement.",
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: ["quadriceps", "glutes"],
  secondaryMuscleGroups: ["hamstrings"],
  equipment: ["barbell"],
  isCustom: false,
  createdBy: null,
};

describe("ExerciseCard", () => {
  it("renders exercise name", () => {
    const { getByText } = renderWithTheme(
      <ExerciseCard
        exercise={baseExercise}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(getByText("Barbell Back Squat")).toBeTruthy();
  });

  it("renders primary muscle group summary", () => {
    const { getByText } = renderWithTheme(
      <ExerciseCard exercise={baseExercise} onPress={jest.fn()} />,
    );
    expect(getByText("Quads, Glutes")).toBeTruthy();
  });

  it("renders category and difficulty badges", () => {
    const { getByText } = renderWithTheme(
      <ExerciseCard exercise={baseExercise} onPress={jest.fn()} />,
    );
    expect(getByText("Strength")).toBeTruthy();
    expect(getByText("Intermediate")).toBeTruthy();
  });

  it("renders equipment summary", () => {
    const { getByText } = renderWithTheme(
      <ExerciseCard exercise={baseExercise} onPress={jest.fn()} />,
    );
    expect(getByText("Barbell")).toBeTruthy();
  });

  it("falls back to Bodyweight when equipment is empty", () => {
    const { getByText } = renderWithTheme(
      <ExerciseCard
        exercise={{ ...baseExercise, equipment: [] }}
        onPress={jest.fn()}
      />,
    );
    expect(getByText("Bodyweight")).toBeTruthy();
  });

  it("falls back to General when primary muscle groups are empty", () => {
    const { getByText } = renderWithTheme(
      <ExerciseCard
        exercise={{ ...baseExercise, primaryMuscleGroups: [] }}
        onPress={jest.fn()}
      />,
    );
    expect(getByText("General")).toBeTruthy();
  });

  it("joins multiple equipment labels with slash", () => {
    const { getByText } = renderWithTheme(
      <ExerciseCard
        exercise={{ ...baseExercise, equipment: ["barbell", "cable"] }}
        onPress={jest.fn()}
      />,
    );
    expect(getByText("Barbell / Cable")).toBeTruthy();
  });

  it("shows CUSTOM badge only when exercise.isCustom is true", () => {
    const { getByTestId, queryByTestId, rerender } = renderWithTheme(
      <ExerciseCard
        exercise={{ ...baseExercise, isCustom: true }}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(getByTestId("card-custom-badge")).toBeTruthy();

    rerender(
      <ExerciseCard
        exercise={baseExercise}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(queryByTestId("card-custom-badge")).toBeNull();
  });

  it("calls onPress with the exercise id", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseCard exercise={baseExercise} onPress={onPress} testID="card" />,
    );
    fireEvent.press(getByTestId("card"));
    expect(onPress).toHaveBeenCalledWith("ex-1");
  });
});
