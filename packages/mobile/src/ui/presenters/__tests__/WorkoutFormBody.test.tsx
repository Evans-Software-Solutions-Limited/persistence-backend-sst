import { fireEvent } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { WorkoutFormBody } from "../WorkoutFormBody";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import type { WorkoutFormState } from "@/ui/hooks/useWorkoutForm";

jest.mock("expo-router", () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/ui/components/workouts/AddExercisePopover", () => ({
  AddExercisePopover: () => null,
}));

const formState: WorkoutFormState = {
  name: "Push",
  description: "",
  visibility: "private",
  showInOwnerLibrary: true,
  exercises: [
    {
      id: "standalone-a",
      exercise_id: "a",
      exercise_name: "Press",
      sort_order: 0,
      target_sets: 3,
      target_reps_min: 8,
      target_reps_max: 12,
      rest_seconds: 60,
      superset_group: null,
    },
    {
      id: "superset-lead",
      exercise_id: "b",
      exercise_name: "Curl",
      sort_order: 1,
      target_sets: 3,
      target_reps_min: 8,
      target_reps_max: 12,
      rest_seconds: 60,
      superset_group: 4,
    },
    {
      id: "superset-peer",
      exercise_id: "c",
      exercise_name: "Extension",
      sort_order: 2,
      target_sets: 3,
      target_reps_min: 8,
      target_reps_max: 12,
      rest_seconds: 60,
      superset_group: 4,
    },
    {
      id: "standalone-d",
      exercise_id: "d",
      exercise_name: "Raise",
      sort_order: 3,
      target_sets: 3,
      target_reps_min: 8,
      target_reps_max: 12,
      rest_seconds: 60,
      superset_group: null,
    },
  ],
};

/** The presenter's required props, so a test can state only what it varies. */
function renderBody(
  overrides: Partial<React.ComponentProps<typeof WorkoutFormBody>> = {},
) {
  return renderWithTheme(
    <WorkoutFormBody
      formState={formState}
      isSubmitting={false}
      hasAttemptedSubmit={false}
      submitError={null}
      pickerVisible={false}
      isCoachContext={false}
      onSetName={jest.fn()}
      onSetDescription={jest.fn()}
      onSetVisibility={jest.fn()}
      onSetShowInOwnerLibrary={jest.fn()}
      onAddExerciseTap={jest.fn()}
      onClosePicker={jest.fn()}
      onAddExercises={jest.fn()}
      onAddSuperset={jest.fn()}
      onRemoveExercise={jest.fn()}
      onExerciseConfigChange={jest.fn()}
      onMoveExercise={jest.fn()}
      onReorderExercise={jest.fn()}
      onSubmit={jest.fn()}
      onCancel={jest.fn()}
      headerTitle="Create Workout"
      backTestID="creator-back-button"
      saveLabel="Save workout"
      ownerToggleSub="Owner copy"
      {...overrides}
    />,
  );
}

/** Two blocks, so there is something to reorder. */
function renderReorderableForm() {
  return renderBody({
    formState: {
      ...formState,
      exercises: [
        ...formState.exercises,
        {
          ...formState.exercises[0],
          id: "second-block",
          exercise_id: "ex-2",
          exercise_name: "Row",
          sort_order: 1,
        },
      ],
    },
  });
}

describe("WorkoutFormBody reorder", () => {
  it("drags full cards from the grip, with no mode and no buttons", () => {
    // The editor used to collapse to fixed-height rows behind an explicit
    // Reorder button because its list was nested inside the form's scroller
    // and the library measured the dragged cell up front. The list IS the
    // form's scroller now, so the cards stay cards and the grip drags them.
    const { getByTestId, queryByTestId } = renderReorderableForm();

    expect(getByTestId("workout-exercise-reorderable-list")).toBeTruthy();
    expect(queryByTestId("workout-reorder")).toBeNull();
    expect(queryByTestId("workout-reorder-done")).toBeNull();
    expect(queryByTestId("compact-reorder-row")).toBeNull();
    // The form fields live in the same scroller as the rows — that is what
    // un-nesting means, and what makes auto-scroll work.
    expect(getByTestId("workout-name-input")).toBeTruthy();
    expect(getByTestId("add-exercise-button")).toBeTruthy();
  });

  it("puts the grip on the block lead only", () => {
    const { getAllByTestId } = renderReorderableForm();
    // One handle per BLOCK, not per exercise.
    expect(getAllByTestId("sortable-handle").length).toBeGreaterThan(0);
  });

  it("offers no Reorder control when there is only one block", () => {
    // Nothing to reorder; the control would do nothing.
    const single = {
      ...formState,
      exercises: [formState.exercises[0]!],
    };
    const { queryByTestId } = renderBody({ formState: single });
    expect(queryByTestId("workout-reorder")).toBeNull();
  });
});

describe("WorkoutFormBody drag reorder", () => {
  it("renders a superset as one draggable block and persists its exact drop", () => {
    const onReorderExercise = jest.fn();
    const onMoveExercise = jest.fn();
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(jest.fn());
    const { getByTestId } = renderWithTheme(
      <WorkoutFormBody
        formState={formState}
        isSubmitting={false}
        hasAttemptedSubmit={false}
        submitError={null}
        pickerVisible={false}
        isCoachContext={false}
        onSetName={jest.fn()}
        onSetDescription={jest.fn()}
        onSetVisibility={jest.fn()}
        onSetShowInOwnerLibrary={jest.fn()}
        onAddExerciseTap={jest.fn()}
        onClosePicker={jest.fn()}
        onAddExercises={jest.fn()}
        onAddSuperset={jest.fn()}
        onRemoveExercise={jest.fn()}
        onExerciseConfigChange={jest.fn()}
        onMoveExercise={onMoveExercise}
        onReorderExercise={onReorderExercise}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
        headerTitle="Create Workout"
        backTestID="creator-back-button"
        saveLabel="Save workout"
        ownerToggleSub="Owner copy"
      />,
    );
    expect(getByTestId("workout-form-screen").props.style).toMatchObject({
      paddingTop: 44,
      paddingBottom: 34,
    });
    expect(getByTestId("workout-exercise-reorderable-list")).toBeTruthy();

    fireEvent(getByTestId("reorder-1"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(onMoveExercise).toHaveBeenCalledWith("standalone-a", 1);

    // Four exercises become three draggable blocks: standalone, superset,
    // standalone. The superset's members render together inside one row, which
    // is addressed by its LEAD exercise's id.
    expect(getByTestId("sortable-item-standalone-a")).toBeTruthy();
    expect(getByTestId("sortable-item-superset-lead")).toBeTruthy();
    fireEvent(
      getByTestId("sortable-item-superset-lead"),
      "drop",
      "superset-lead",
      0,
      { "superset-lead": 0, "standalone-a": 1 },
    );

    expect(onReorderExercise).toHaveBeenCalledWith("superset-lead", 0);
    expect(announce).toHaveBeenCalledWith(
      "Superset starting with Curl moved to position 1 of 3",
    );
  });
});
