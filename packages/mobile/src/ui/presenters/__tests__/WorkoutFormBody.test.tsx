import { fireEvent } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { WorkoutFormBody } from "../WorkoutFormBody";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { reorderableTestApi } from "../../../../__tests__/reorderable-test-api";
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

// Reorder mode (PER-67, Brad 10 Nov 2026): a Reorder button beside the
// Exercises heading, compact rows with drag handles, Done to leave.
describe("WorkoutFormBody reorder", () => {
  it("enters reorder mode from the Reorder button and leaves on Done", () => {
    const { getAllByTestId, getByTestId, queryByTestId } =
      renderReorderableForm();

    // At rest: the form and its cards, no drag rows or handles.
    expect(getByTestId("workout-name-input")).toBeTruthy();
    expect(queryByTestId("compact-reorder-row")).toBeNull();
    expect(queryByTestId("sortable-handle-standalone-a")).toBeNull();

    fireEvent.press(getByTestId("reorder-exercises"));

    expect(getByTestId("workout-form-reorder")).toBeTruthy();
    expect(getAllByTestId("compact-reorder-row").length).toBe(4);
    expect(queryByTestId("workout-name-input")).toBeNull();

    fireEvent.press(getByTestId("reorder-mode-bar-done"));

    expect(getByTestId("workout-name-input")).toBeTruthy();
    expect(queryByTestId("compact-reorder-row")).toBeNull();
  });

  it("gives every block one reorder row with its own handle", () => {
    const { getByTestId, queryByTestId } = renderBody();
    fireEvent.press(getByTestId("reorder-exercises"));

    // Four exercises, three blocks: the superset's members share one row,
    // addressed by its LEAD.
    expect(getByTestId("sortable-handle-standalone-a")).toBeTruthy();
    expect(getByTestId("sortable-handle-superset-lead")).toBeTruthy();
    expect(getByTestId("sortable-handle-standalone-d")).toBeTruthy();
    expect(queryByTestId("sortable-handle-superset-peer")).toBeNull();
  });

  it("offers no Reorder button on a one-block list", () => {
    const { getByTestId, queryByTestId } = renderBody({
      formState: { ...formState, exercises: [formState.exercises[0]!] },
    });

    expect(queryByTestId("reorder-exercises")).toBeNull();
    expect(queryByTestId("reorder-1")).toBeNull();
    expect(getByTestId("workout-name-input")).toBeTruthy();
  });

  it("offers no Reorder button without a commit callback", () => {
    const { queryByTestId } = renderBody({ onReorderExercise: undefined });

    expect(queryByTestId("reorder-exercises")).toBeNull();
  });
});

describe("WorkoutFormBody drag reorder", () => {
  it("persists a superset's exact drop and announces it", () => {
    const onReorderExercise = jest.fn();
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(jest.fn());
    const { getByTestId } = renderBody({ onReorderExercise });

    expect(getByTestId("workout-form-screen").props.style).toMatchObject({
      paddingTop: 44,
      paddingBottom: 34,
    });
    fireEvent.press(getByTestId("reorder-exercises"));

    reorderableTestApi.dragStart("superset-lead");
    reorderableTestApi.drop("superset-lead", 0, {
      "superset-lead": 0,
      "standalone-a": 1,
      "standalone-d": 2,
    });

    expect(onReorderExercise).toHaveBeenCalledWith("superset-lead", 0);
    expect(announce).toHaveBeenCalledWith(
      "Superset starting with Curl moved to position 1 of 3",
    );
  });

  it("offers VoiceOver Move actions on the reorder rows", () => {
    const onMoveExercise = jest.fn();
    const { getByTestId } = renderBody({ onMoveExercise });
    fireEvent.press(getByTestId("reorder-exercises"));

    fireEvent(getByTestId("reorder-1"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(onMoveExercise).toHaveBeenCalledWith("standalone-a", 1);
  });
});
