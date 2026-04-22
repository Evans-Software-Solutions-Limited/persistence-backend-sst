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
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: false,
  createdBy: null,
};

describe("ExerciseCard", () => {
  it("renders the exercise name as the title", () => {
    const { getByText } = renderWithTheme(
      <ExerciseCard
        exercise={baseExercise}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(getByText("Barbell Back Squat")).toBeTruthy();
  });

  it("renders the difficulty pill label with correct capitalisation", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ExerciseCard
        exercise={baseExercise}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(getByTestId("card-difficulty")).toBeTruthy();
    expect(getByText("Intermediate")).toBeTruthy();
  });

  it.each([
    ["beginner", "Beginner"],
    ["intermediate", "Intermediate"],
    ["advanced", "Advanced"],
    ["expert", "Expert"],
  ] as const)(
    "renders the '%s' difficulty pill with label '%s'",
    (difficulty, label) => {
      const { getByText } = renderWithTheme(
        <ExerciseCard
          exercise={{ ...baseExercise, difficulty }}
          onPress={jest.fn()}
        />,
      );
      expect(getByText(label)).toBeTruthy();
    },
  );

  it("renders the description with 2-line truncation when present", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseCard
        exercise={baseExercise}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    const desc = getByTestId("card-description");
    expect(desc.props.numberOfLines).toBe(2);
  });

  it("omits the description row when description is null", () => {
    const { queryByTestId } = renderWithTheme(
      <ExerciseCard
        exercise={{ ...baseExercise, description: null }}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(queryByTestId("card-description")).toBeNull();
  });

  it("renders primary muscle groups (max 2 visible, overflow +N)", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <ExerciseCard
        exercise={{
          ...baseExercise,
          primaryMuscleGroups: ["quadriceps", "glutes", "hamstrings"],
        }}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(getByText("Quads")).toBeTruthy();
    expect(getByText("Glutes")).toBeTruthy();
    expect(getByTestId("card-muscles-overflow")).toBeTruthy();
    expect(getByText("+1")).toBeTruthy();
  });

  it("renders equipment (max 3 visible, overflow '+N more')", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <ExerciseCard
        exercise={{
          ...baseExercise,
          equipment: ["barbell", "cable", "dumbbell", "kettlebell", "machine"],
        }}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(getByText("Barbell")).toBeTruthy();
    expect(getByText("Cable")).toBeTruthy();
    expect(getByText("Dumbbell")).toBeTruthy();
    expect(getByTestId("card-equipment-overflow")).toBeTruthy();
    expect(getByText("+2 more")).toBeTruthy();
  });

  it("omits the equipment row entirely when equipment is empty", () => {
    const { queryByTestId } = renderWithTheme(
      <ExerciseCard
        exercise={{ ...baseExercise, equipment: [] }}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(queryByTestId("card-equipment")).toBeNull();
  });

  it("omits the muscles row entirely when primary muscle groups is empty", () => {
    const { queryByTestId } = renderWithTheme(
      <ExerciseCard
        exercise={{ ...baseExercise, primaryMuscleGroups: [] }}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(queryByTestId("card-muscles")).toBeNull();
  });

  it("shows the primary left-accent only when isCustom is true", () => {
    const { queryByTestId, rerender } = renderWithTheme(
      <ExerciseCard
        exercise={baseExercise}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(queryByTestId("card-custom-accent")).toBeNull();

    rerender(
      <ExerciseCard
        exercise={{ ...baseExercise, isCustom: true }}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(queryByTestId("card-custom-accent")).toBeTruthy();
  });

  it("fires onPress with the exercise id when the card is tapped", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseCard exercise={baseExercise} onPress={onPress} testID="card" />,
    );
    fireEvent.press(getByTestId("card"));
    expect(onPress).toHaveBeenCalledWith("ex-1");
  });

  describe("chip label resolution", () => {
    // Regression: the adapter's `resolveUuidsToLabels` emits a parallel-
    // indexed array (unresolved UUIDs → empty string). The card must pair
    // ids↔labels by index BEFORE filtering empties, otherwise a partial
    // reference-list lookup silently mispairs labels against ids.
    //
    // Pre-fix, `labels.map((label, i) => ({ key: ids[i], label }))` with
    // ids=[A,B,C] and labels=["LabelA","LabelC"] (2 elements — missing
    // one was silently dropped) would produce:
    //   { key: A, label: "LabelA" }  // correct
    //   { key: B, label: "LabelC" }  // WRONG — should be key C
    // Post-fix the adapter emits parallel-length labels=["LabelA","","LabelC"],
    // and the card filters the empty entry AFTER pairing, preserving
    // key C for label "LabelC".
    it("preserves id↔label alignment when some UUIDs don't resolve", () => {
      const uuidA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const uuidB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      const uuidC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const exercise: Exercise = {
        ...baseExercise,
        primaryMuscleGroups: [
          uuidA,
          uuidB,
          uuidC,
        ] as unknown as Exercise["primaryMuscleGroups"],
        primaryMuscleGroupLabels: ["LabelA", "", "LabelC"],
        equipment: [] as unknown as Exercise["equipment"],
        equipmentLabels: [],
      };

      const { getByText, queryByText, getByTestId } = renderWithTheme(
        <ExerciseCard exercise={exercise} onPress={jest.fn()} testID="card" />,
      );

      // Both resolved chips render; the empty-slot one is filtered out.
      // Muscle-row max is 2 — both slots exactly filled, no overflow chip.
      expect(getByText("LabelA")).toBeTruthy();
      expect(getByText("LabelC")).toBeTruthy();
      expect(queryByText("")).toBeNull();
      // The chip row renders (muscles testID present), proving it wasn't
      // suppressed by the empty-filter.
      expect(getByTestId("card-muscles")).toBeTruthy();
    });

    it("renders no chips when the labels array is a same-length all-empty-strings (reference lookup hydrated but row has no matches)", () => {
      const exercise: Exercise = {
        ...baseExercise,
        primaryMuscleGroups: [
          "uuid-1",
          "uuid-2",
        ] as unknown as Exercise["primaryMuscleGroups"],
        primaryMuscleGroupLabels: ["", ""],
        equipment: [] as unknown as Exercise["equipment"],
        equipmentLabels: [],
      };

      const { queryByTestId } = renderWithTheme(
        <ExerciseCard exercise={exercise} onPress={jest.fn()} testID="card" />,
      );

      // No chip row at all when every label is empty post-filter.
      expect(queryByTestId("card-muscles")).toBeNull();
    });

    it("falls back to legacy enum→label map when labels array is empty (reference lookup not hydrated)", () => {
      const exercise: Exercise = {
        ...baseExercise,
        // Legacy-shape data: ids hold enum keys matching MUSCLE_GROUP_LABELS.
        primaryMuscleGroups: ["quadriceps", "glutes"],
        primaryMuscleGroupLabels: undefined,
        equipment: ["barbell"],
        equipmentLabels: undefined,
      };

      const { getByText } = renderWithTheme(
        <ExerciseCard exercise={exercise} onPress={jest.fn()} testID="card" />,
      );
      expect(getByText("Quads")).toBeTruthy();
      expect(getByText("Glutes")).toBeTruthy();
      expect(getByText("Barbell")).toBeTruthy();
    });
  });
});
