import { fireEvent } from "@testing-library/react-native";

import type { Exercise } from "@/domain/models/exercise";
import { ExerciseCard } from "@/ui/components/exercises/ExerciseCard";
import { cardPressStyle } from "@/ui/components/exercises/ExerciseCard/ExerciseCard";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise =>
  ({
    id: "ex-1",
    name: "Bench Press",
    description: "Compound chest press.",
    difficulty: "intermediate",
    primaryMuscleGroups: ["uuid-chest"],
    primaryMuscleGroupLabels: ["Chest"],
    equipment: ["uuid-barbell"],
    equipmentLabels: ["Barbell"],
    isCustom: false,
    ...overrides,
  }) as unknown as Exercise;

describe("ExerciseCard (library)", () => {
  it("renders name, capitalised difficulty, and label-derived pills", () => {
    const { getByText } = renderWithTheme(
      <ExerciseCard exercise={buildExercise()} onPress={jest.fn()} />,
    );
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByText("Intermediate")).toBeTruthy(); // not "intermediate"
    expect(getByText("Compound chest press.")).toBeTruthy();
    expect(getByText("Chest")).toBeTruthy(); // from primaryMuscleGroupLabels
    expect(getByText("Barbell")).toBeTruthy(); // from equipmentLabels
  });

  it("fires onPress with the exercise id", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseCard
        exercise={buildExercise({ id: "ex-9" })}
        onPress={onPress}
        testID="card"
      />,
    );
    fireEvent.press(getByTestId("card"));
    expect(onPress).toHaveBeenCalledWith("ex-9");
  });

  it("fires onLongPress with the exercise id when provided", () => {
    const onLongPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseCard
        exercise={buildExercise({ id: "ex-7" })}
        onPress={jest.fn()}
        onLongPress={onLongPress}
        testID="card"
      />,
    );
    fireEvent(getByTestId("card"), "longPress");
    expect(onLongPress).toHaveBeenCalledWith("ex-7");
  });

  it("omits the description and tag row when there's no description or labels", () => {
    const { queryByText } = renderWithTheme(
      <ExerciseCard
        exercise={buildExercise({
          name: "Bare",
          description: null,
          primaryMuscleGroupLabels: [],
          equipmentLabels: [],
        })}
        onPress={jest.fn()}
      />,
    );
    expect(queryByText("Compound chest press.")).toBeNull();
    expect(queryByText("Chest")).toBeNull();
  });

  it("handles undefined label arrays (pre-reference-list) gracefully", () => {
    const { getByText, queryByText } = renderWithTheme(
      <ExerciseCard
        exercise={buildExercise({
          name: "Unlabelled",
          primaryMuscleGroupLabels: undefined,
          equipmentLabels: undefined,
        })}
        onPress={jest.fn()}
      />,
    );
    expect(getByText("Unlabelled")).toBeTruthy();
    expect(queryByText("Chest")).toBeNull();
    expect(queryByText("Barbell")).toBeNull();
  });

  it("dims to 0.9 opacity while pressed", () => {
    expect(cardPressStyle({ pressed: true }).opacity).toBe(0.9);
    expect(cardPressStyle({ pressed: false }).opacity).toBe(1);
  });

  it("skips empty-string labels (unresolved UUIDs) and uses the first non-empty muscle", () => {
    const { getByText } = renderWithTheme(
      <ExerciseCard
        exercise={buildExercise({
          // Leading "" is an unresolved UUID — must not swallow the row.
          primaryMuscleGroupLabels: ["", "Back"],
          // Empty entries must be dropped, not rendered as ghost pills.
          equipmentLabels: ["", "Barbell", ""],
        })}
        onPress={jest.fn()}
      />,
    );
    expect(getByText("Back")).toBeTruthy();
    expect(getByText("Barbell")).toBeTruthy();
  });

  it("renders no tag row when every label is an empty string", () => {
    const { queryByText } = renderWithTheme(
      <ExerciseCard
        exercise={buildExercise({
          name: "All Unresolved",
          primaryMuscleGroupLabels: ["", ""],
          equipmentLabels: ["", ""],
        })}
        onPress={jest.fn()}
      />,
    );
    expect(queryByText("Chest")).toBeNull();
    expect(queryByText("Barbell")).toBeNull();
  });
});
