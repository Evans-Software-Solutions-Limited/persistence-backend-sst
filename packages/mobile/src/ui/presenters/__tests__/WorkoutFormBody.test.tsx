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
    const list = getByTestId("workout-exercise-draggable-list");
    expect(list.props.dragItemOverflow).toBeUndefined();
    expect(list.props.renderPlaceholder).toEqual(expect.any(Function));
    expect(list.props.renderPlaceholder()).toBeTruthy();

    fireEvent(getByTestId("reorder-1"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(onMoveExercise).toHaveBeenCalledWith("standalone-a", 1);

    // Four exercises become three draggable blocks: standalone, superset,
    // standalone. The superset's members render together inside block 2.
    expect(list.props.children).toHaveLength(3);
    fireEvent(list, "dragEnd", { from: 1, to: 0 });

    expect(onReorderExercise).toHaveBeenCalledWith("superset-lead", 0);
    expect(announce).toHaveBeenCalledWith(
      "Superset starting with Curl moved to position 1 of 3",
    );
  });
});
