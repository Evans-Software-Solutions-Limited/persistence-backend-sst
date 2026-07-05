import {
  fireEvent,
  renderWithTheme,
} from "../../../../../__tests__/test-utils";
import type { ProgramAssignmentEntry } from "@/domain/models/program";
import {
  ProgramEditorPresenter,
  type ProgramEditorPresenterProps,
} from "../ProgramEditorPresenter";

function baseProps(
  overrides: Partial<ProgramEditorPresenterProps> = {},
): ProgramEditorPresenterProps {
  return {
    mode: "create",
    name: "",
    onNameChange: jest.fn(),
    description: "",
    onDescriptionChange: jest.fn(),
    durationMode: "fixed",
    onDurationModeChange: jest.fn(),
    durationWeeks: 8,
    onDurationWeeksChange: jest.fn(),
    daysPerWeek: 3,
    onDaysPerWeekChange: jest.fn(),
    workouts: [],
    onMoveWorkout: jest.fn(),
    onRemoveWorkout: jest.fn(),
    availableWorkouts: [],
    onAddWorkout: jest.fn(),
    assignments: [],
    onAssignClient: jest.fn(),
    onSave: jest.fn(),
    saving: false,
    saveError: null,
    canSave: true,
    onDelete: jest.fn(),
    deleting: false,
    onBack: jest.fn(),
    isLoading: false,
    loadError: null,
    onRetryLoad: jest.fn(),
    testID: "program-editor",
    ...overrides,
  };
}

/**
 * Props omitting a key entirely (rather than setting it to `undefined`)
 * so the component's own default value / `??` fallback actually engages —
 * spreading `{ ...overrides }` over `baseProps()` would otherwise carry the
 * jest.fn() default through.
 */
function propsWithout(
  keys: (keyof ProgramEditorPresenterProps)[],
  overrides: Partial<ProgramEditorPresenterProps> = {},
): ProgramEditorPresenterProps {
  const merged: Record<string, unknown> = { ...baseProps(overrides) };
  for (const key of keys) delete merged[key];
  return merged as unknown as ProgramEditorPresenterProps;
}

function makeAssignment(
  overrides: Partial<ProgramAssignmentEntry> = {},
): ProgramAssignmentEntry {
  return {
    id: "a-1",
    clientId: "c-1",
    clientName: "Priya Shah",
    clientInitials: "PS",
    avatarUrl: null,
    startDate: "2026-06-01",
    endDate: null,
    status: "started",
    currentWeek: 3,
    ...overrides,
  };
}

describe("ProgramEditorPresenter", () => {
  it("renders the loader when isLoading", () => {
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter {...baseProps({ isLoading: true })} />,
    );
    expect(getByTestId("program-editor-loader")).toBeTruthy();
  });

  it("renders the error state when loadError is set", () => {
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({
          loadError: { kind: "api", code: "not_found", message: "boom" },
        })}
      />,
    );
    expect(getByTestId("program-editor-error")).toBeTruthy();
  });

  it("shows 'New programme' title in create mode, no assignments/delete section", () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <ProgramEditorPresenter {...baseProps({ mode: "create" })} />,
    );
    expect(getByText("New programme")).toBeTruthy();
    expect(queryByTestId("program-delete")).toBeNull();
    expect(queryByTestId("editor-assign-client")).toBeNull();
  });

  it("shows 'Edit programme' title and the assignments section in edit mode", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({
          mode: "edit",
          assignments: [makeAssignment()],
        })}
      />,
    );
    expect(getByText("Edit programme")).toBeTruthy();
    expect(getByTestId("editor-assignment-a-1")).toBeTruthy();
    expect(getByText("Priya Shah")).toBeTruthy();
    expect(getByTestId("program-delete")).toBeTruthy();
    expect(getByTestId("editor-assign-client")).toBeTruthy();
  });

  it("shows a bare week number (no 'Ongoing' suffix) once an assignment has an end date", () => {
    const { getByText } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({
          mode: "edit",
          assignments: [
            makeAssignment({ endDate: "2026-08-01", currentWeek: 5 }),
          ],
        })}
      />,
    );
    expect(getByText("Wk 5")).toBeTruthy();
  });

  it("shows 'Wk N · Ongoing' when the assignment has no end date", () => {
    const { getByText } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({
          mode: "edit",
          assignments: [makeAssignment({ endDate: null, currentWeek: 2 })],
        })}
      />,
    );
    expect(getByText("Wk 2 · Ongoing")).toBeTruthy();
  });

  it("shows a neutral pill tone for a completed/skipped assignment", () => {
    const { getByText } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({
          mode: "edit",
          assignments: [makeAssignment({ status: "completed" })],
        })}
      />,
    );
    expect(getByText("COMPLETED")).toBeTruthy();
  });

  it("shows the empty assignments copy when the programme has no clients", () => {
    const { getByText } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ mode: "edit", assignments: [] })}
      />,
    );
    expect(getByText("Not assigned to anyone yet.")).toBeTruthy();
  });

  it("fires onAssignClient from the CTA", () => {
    const onAssignClient = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ mode: "edit", onAssignClient })}
      />,
    );
    fireEvent.press(getByTestId("editor-assign-client"));
    expect(onAssignClient).toHaveBeenCalledTimes(1);
  });

  it("fires onDelete from the delete button", () => {
    const onDelete = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter {...baseProps({ mode: "edit", onDelete })} />,
    );
    fireEvent.press(getByTestId("program-delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("forwards name/description text changes", () => {
    const onNameChange = jest.fn();
    const onDescriptionChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ onNameChange, onDescriptionChange })}
      />,
    );
    fireEvent.changeText(getByTestId("program-name"), "Strength Foundations");
    expect(onNameChange).toHaveBeenCalledWith("Strength Foundations");
    fireEvent.changeText(getByTestId("program-description"), "4 days/wk");
    expect(onDescriptionChange).toHaveBeenCalledWith("4 days/wk");
  });

  it("shows the weeks input under Fixed weeks and hides it under Ongoing", () => {
    const { getByTestId, queryByTestId, rerender } = renderWithTheme(
      <ProgramEditorPresenter {...baseProps({ durationMode: "fixed" })} />,
    );
    expect(getByTestId("program-duration-weeks")).toBeTruthy();

    rerender(
      <ProgramEditorPresenter {...baseProps({ durationMode: "ongoing" })} />,
    );
    expect(queryByTestId("program-duration-weeks")).toBeNull();
  });

  it("shows the ongoing helper copy when durationMode is ongoing", () => {
    const { getByText } = renderWithTheme(
      <ProgramEditorPresenter {...baseProps({ durationMode: "ongoing" })} />,
    );
    expect(
      getByText("Runs indefinitely — sessions roll forward automatically."),
    ).toBeTruthy();
  });

  it("parses digits typed into the weeks input and drops non-digit characters", () => {
    const onDurationWeeksChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ durationMode: "fixed", onDurationWeeksChange })}
      />,
    );
    fireEvent.changeText(getByTestId("program-duration-weeks"), "1a2b");
    expect(onDurationWeeksChange).toHaveBeenCalledWith(12);
  });

  it("falls back to 0 when the weeks input has no digits", () => {
    const onDurationWeeksChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ durationMode: "fixed", onDurationWeeksChange })}
      />,
    );
    fireEvent.changeText(getByTestId("program-duration-weeks"), "abc");
    expect(onDurationWeeksChange).toHaveBeenCalledWith(0);
  });

  it("switches duration mode via the segmented control", () => {
    const onDurationModeChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ durationMode: "fixed", onDurationModeChange })}
      />,
    );
    fireEvent.press(getByTestId("program-duration-mode-option-Ongoing"));
    expect(onDurationModeChange).toHaveBeenCalledWith("ongoing");
  });

  it("steps days-per-week within 1..7 via the stepper", () => {
    const onDaysPerWeekChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ daysPerWeek: 3, onDaysPerWeekChange })}
      />,
    );
    fireEvent.press(getByTestId("program-days-inc"));
    expect(onDaysPerWeekChange).toHaveBeenCalledWith(4);
    fireEvent.press(getByTestId("program-days-dec"));
    expect(onDaysPerWeekChange).toHaveBeenCalledWith(2);
  });

  it("disables the days-per-week decrement at the floor of 1", () => {
    const onDaysPerWeekChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ daysPerWeek: 1, onDaysPerWeekChange })}
      />,
    );
    fireEvent.press(getByTestId("program-days-dec"));
    expect(onDaysPerWeekChange).not.toHaveBeenCalled();
  });

  it("disables the days-per-week increment at the ceiling of 7", () => {
    const onDaysPerWeekChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ daysPerWeek: 7, onDaysPerWeekChange })}
      />,
    );
    fireEvent.press(getByTestId("program-days-inc"));
    expect(onDaysPerWeekChange).not.toHaveBeenCalled();
  });

  it("renders the empty-workouts copy, then rows once workouts are present", () => {
    const { getByText, getByTestId, rerender } = renderWithTheme(
      <ProgramEditorPresenter {...baseProps({ workouts: [] })} />,
    );
    expect(
      getByText("No workouts yet — add at least one to assign this programme."),
    ).toBeTruthy();

    rerender(
      <ProgramEditorPresenter
        {...baseProps({
          workouts: [
            { workoutId: "w-1", name: "Push Day" },
            { workoutId: "w-2", name: "Pull Day" },
          ],
        })}
      />,
    );
    expect(getByTestId("editor-workout-0")).toBeTruthy();
    expect(getByText("Push Day")).toBeTruthy();
    expect(getByText("Pull Day")).toBeTruthy();
  });

  it("fires onMoveWorkout with the correct index + direction", () => {
    const onMoveWorkout = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({
          workouts: [
            { workoutId: "w-1", name: "Push Day" },
            { workoutId: "w-2", name: "Pull Day" },
          ],
          onMoveWorkout,
        })}
      />,
    );
    fireEvent.press(getByTestId("editor-workout-1-up"));
    expect(onMoveWorkout).toHaveBeenCalledWith(1, -1);
    fireEvent.press(getByTestId("editor-workout-0-down"));
    expect(onMoveWorkout).toHaveBeenCalledWith(0, 1);
  });

  it("disables move-up on the first row and move-down on the last row", () => {
    const onMoveWorkout = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({
          workouts: [
            { workoutId: "w-1", name: "Push Day" },
            { workoutId: "w-2", name: "Pull Day" },
          ],
          onMoveWorkout,
        })}
      />,
    );
    fireEvent.press(getByTestId("editor-workout-0-up"));
    fireEvent.press(getByTestId("editor-workout-1-down"));
    expect(onMoveWorkout).not.toHaveBeenCalled();
  });

  it("fires onRemoveWorkout with the row index", () => {
    const onRemoveWorkout = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({
          workouts: [{ workoutId: "w-1", name: "Push Day" }],
          onRemoveWorkout,
        })}
      />,
    );
    fireEvent.press(getByTestId("editor-workout-0-remove"));
    expect(onRemoveWorkout).toHaveBeenCalledWith(0);
  });

  it("opens the workout picker and adds a workout, closing the sheet", () => {
    const onAddWorkout = jest.fn();
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({
          availableWorkouts: [{ id: "w-9", name: "Leg Day" }],
          onAddWorkout,
        })}
      />,
    );
    expect(queryByTestId("editor-workout-picker")).toBeNull();
    fireEvent.press(getByTestId("editor-add-workout"));
    expect(getByTestId("editor-workout-picker")).toBeTruthy();
    fireEvent.press(getByTestId("picker-workout-w-9"));
    expect(onAddWorkout).toHaveBeenCalledWith("w-9", "Leg Day");
  });

  it("shows a message in the picker when there are no available workouts", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ProgramEditorPresenter {...baseProps({ availableWorkouts: [] })} />,
    );
    fireEvent.press(getByTestId("editor-add-workout"));
    expect(
      getByText("No workouts to add — create one from the Train tab first."),
    ).toBeTruthy();
  });

  it("shows the save error message when present", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ saveError: "Couldn't save the programme." })}
      />,
    );
    expect(getByTestId("program-save-error")).toBeTruthy();
    expect(getByText("Couldn't save the programme.")).toBeTruthy();
  });

  it("disables Save when canSave is false or saving", () => {
    const { getByTestId, rerender } = renderWithTheme(
      <ProgramEditorPresenter {...baseProps({ canSave: false })} />,
    );
    expect(getByTestId("program-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });

    rerender(
      <ProgramEditorPresenter
        {...baseProps({ canSave: true, saving: true })}
      />,
    );
    expect(getByTestId("program-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it("fires onSave when enabled", () => {
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter {...baseProps({ onSave, canSave: true })} />,
    );
    fireEvent.press(getByTestId("program-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("shows create/edit save-button copy per mode", () => {
    const { getByText, rerender } = renderWithTheme(
      <ProgramEditorPresenter {...baseProps({ mode: "create" })} />,
    );
    expect(getByText("Create programme")).toBeTruthy();

    rerender(<ProgramEditorPresenter {...baseProps({ mode: "edit" })} />);
    expect(getByText("Save changes")).toBeTruthy();
  });

  it("fires onBack from the header back button", () => {
    const onBack = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter {...baseProps({ onBack })} />,
    );
    fireEvent.press(getByTestId("program-editor-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("defaults assignments to an empty list when the prop is omitted", () => {
    const { getByText } = renderWithTheme(
      <ProgramEditorPresenter
        {...propsWithout(["assignments"], { mode: "edit" })}
      />,
    );
    expect(getByText("Not assigned to anyone yet.")).toBeTruthy();
  });

  it("falls back to onBack for the error state's retry when onRetryLoad is omitted", () => {
    const onBack = jest.fn();
    const { getByText } = renderWithTheme(
      <ProgramEditorPresenter
        {...propsWithout(["onRetryLoad"], {
          onBack,
          loadError: { kind: "api", code: "not_found", message: "boom" },
        })}
      />,
    );
    fireEvent.press(getByText("Retry"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("switches back to Fixed weeks via the segmented control", () => {
    const onDurationModeChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ durationMode: "ongoing", onDurationModeChange })}
      />,
    );
    fireEvent.press(getByTestId("program-duration-mode-option-Fixed weeks"));
    expect(onDurationModeChange).toHaveBeenCalledWith("fixed");
  });

  it("no-ops the assign-client CTA when onAssignClient is omitted", () => {
    const { getByTestId } = renderWithTheme(
      <ProgramEditorPresenter
        {...propsWithout(["onAssignClient"], { mode: "edit" })}
      />,
    );
    expect(() =>
      fireEvent.press(getByTestId("editor-assign-client")),
    ).not.toThrow();
  });

  it("shows 'Deleting…' on the delete button while deleting", () => {
    const { getByText } = renderWithTheme(
      <ProgramEditorPresenter
        {...baseProps({ mode: "edit", deleting: true })}
      />,
    );
    expect(getByText("Deleting…")).toBeTruthy();
  });
});
