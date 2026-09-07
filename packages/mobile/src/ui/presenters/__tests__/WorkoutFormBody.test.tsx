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

describe("WorkoutFormBody reorder mode", () => {
  it("drags fixed-height rows with exact geometry, not full cards", () => {
    // The bug: this list dragged full exercise cards whose heights vary with
    // set count, so the library — which measures the dragged cell when the
    // drag begins and animates from that — fought the finger from part-way
    // down the list. Compact rows of one known height, described exactly by
    // `getItemLayout`, leave it nothing to get wrong.
    const { getByTestId, getAllByTestId, queryAllByTestId } = renderBody();

    // Full cards: no fixed geometry, because there is none to state.
    expect(
      getByTestId("workout-exercise-draggable-list").props.getItemLayout,
    ).toBeUndefined();
    expect(queryAllByTestId("compact-reorder-row")).toHaveLength(0);

    fireEvent.press(getByTestId("workout-reorder"));

    expect(getAllByTestId("compact-reorder-row").length).toBeGreaterThan(0);
    const getItemLayout = getByTestId("workout-exercise-draggable-list").props
      .getItemLayout as (
      data: unknown,
      index: number,
    ) => { length: number; offset: number; index: number };
    expect(getItemLayout(null, 0)).toEqual({ length: 72, offset: 0, index: 0 });
    // 72pt rows separated by this list's OWN 10pt separator — not the active
    // session's 16pt gap, which would drift 6pt per row.
    expect(getItemLayout(null, 1).offset).toBe(82);
    expect(getItemLayout(null, 4).offset).toBe(82 * 4);
  });

  it("leaves reorder mode by an explicit Done", () => {
    const { getByTestId, queryAllByTestId } = renderBody();
    fireEvent.press(getByTestId("workout-reorder"));
    expect(queryAllByTestId("compact-reorder-row").length).toBeGreaterThan(0);

    fireEvent.press(getByTestId("workout-reorder-done"));

    expect(queryAllByTestId("compact-reorder-row")).toHaveLength(0);
    expect(getByTestId("add-exercise-button")).toBeTruthy();
  });

  it("hides the Reorder control while reordering, so Done is the only exit", () => {
    const { getByTestId, queryByTestId } = renderBody();
    fireEvent.press(getByTestId("workout-reorder"));
    expect(queryByTestId("workout-reorder")).toBeNull();
    expect(getByTestId("workout-reorder-done")).toBeTruthy();
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
