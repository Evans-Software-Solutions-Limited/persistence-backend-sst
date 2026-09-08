import { fireEvent, waitFor } from "@testing-library/react-native";
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
  it("holds a grip to collapse into uniform rows, with no buttons", async () => {
    // The editor used to hide reorder behind a Reorder button and keep its
    // list nested inside the form's scroller, whose stale offset broke
    // auto-scroll. Holding a grip now collapses to uniform rows — uniform
    // because the sortable only drags reliably that way — and the compact
    // list is the only scroller while it is up.
    const { getAllByTestId, getByTestId, queryByTestId } =
      renderReorderableForm();

    // Idle: the form and full cards, and no way in but the grip.
    expect(getByTestId("workout-name-input")).toBeTruthy();
    expect(queryByTestId("compact-reorder-row")).toBeNull();
    // The grip is the only way in, and it says so. (Asserting the deleted
    // button testIDs proves nothing — `queryByTestId` matches exactly, so
    // those assertions pass whatever the presenter renders.)
    expect(getByTestId("reorder-1").props.accessibilityHint).toBe(
      "Hold to reorder, or use Move up and Move down actions",
    );

    fireEvent(getByTestId("reorder-1"), "longPress");

    // The flip is deferred a tick so the focused input's blur can commit.
    await waitFor(() =>
      expect(getByTestId("workout-exercise-reorder-list")).toBeTruthy(),
    );
    expect(getAllByTestId("compact-reorder-row").length).toBeGreaterThan(1);
    // The form is out of the way, so there is no nested scroller at all.
    expect(queryByTestId("workout-name-input")).toBeNull();
  });

  it("puts the drag on a handle, never the whole row", async () => {
    const { getAllByTestId, getByTestId } = renderReorderableForm();

    fireEvent(getByTestId("reorder-1"), "longPress");

    await waitFor(() =>
      expect(getAllByTestId("sortable-handle").length).toBeGreaterThan(0),
    );
  });

  it("shows no grip at all on a one-block list", async () => {
    // Nothing to reorder, so no affordance: no drag, no mode to enter, and no
    // Move actions (both filters are empty at "position 1 of 1"). This used to
    // assert `queryByTestId("workout-reorder")` was null — a testID deleted
    // with the Reorder button earlier on this branch, so it passed no matter
    // what the presenter did, leaving the one-block path untested.
    const single = {
      ...formState,
      exercises: [formState.exercises[0]!],
    };
    const { getByTestId, queryByTestId } = renderBody({ formState: single });

    expect(queryByTestId("reorder-1")).toBeNull();
    expect(queryByTestId("compact-reorder-row")).toBeNull();
    // The form itself is untouched and still the only scroller.
    expect(getByTestId("workout-name-input")).toBeTruthy();
    await waitFor(() =>
      expect(queryByTestId("workout-exercise-reorder-list")).toBeNull(),
    );
  });

  it("offers no reorder at all without a commit callback", async () => {
    // Two blocks, but nothing to persist a drop with: `onReorderExercise?.()`
    // would swallow every drop, so collapsing into compact rows would be a
    // mode the user cannot get anything out of.
    const { getByTestId, queryByTestId } = renderBody({
      formState: {
        ...formState,
        exercises: [
          ...formState.exercises,
          {
            ...formState.exercises[0]!,
            id: "second-block",
            exercise_id: "ex-2",
            exercise_name: "Row",
          },
        ],
      },
      onReorderExercise: undefined,
    });

    fireEvent(getByTestId("reorder-1"), "longPress");

    await waitFor(() =>
      expect(queryByTestId("workout-exercise-reorder-list")).toBeNull(),
    );
    expect(getByTestId("workout-name-input")).toBeTruthy();
  });
});

describe("WorkoutFormBody drag reorder", () => {
  it("renders a superset as one draggable block and persists its exact drop", async () => {
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
    // The accessible Move actions live on the IDLE grip. They are withheld in
    // compact mode on purpose: the sortable seeds its positions map once, so a
    // move arriving from outside the drag would desync it.
    fireEvent(getByTestId("reorder-1"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(onMoveExercise).toHaveBeenCalledWith("standalone-a", 1);

    fireEvent(getByTestId("reorder-1"), "longPress");

    // Four exercises become three draggable blocks: standalone, superset,
    // standalone. The superset's members collapse into ONE row, addressed by
    // its LEAD exercise's id. The flip is deferred a tick so a focused input's
    // blur can commit first.
    await waitFor(() =>
      expect(getByTestId("sortable-item-standalone-a")).toBeTruthy(),
    );
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
