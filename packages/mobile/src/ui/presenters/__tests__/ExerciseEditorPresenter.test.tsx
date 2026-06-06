import { act, fireEvent } from "@testing-library/react-native";

import type { Exercise } from "@/domain/models/exercise";
import {
  ExerciseEditorPresenter,
  SAVED_AFFIRMATION_MS,
} from "@/ui/presenters/ExerciseEditorPresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const exercise: Exercise = {
  id: "ex-1",
  name: "Bench Press",
  description: null,
  instructions: "Tuck elbows",
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: ["triceps"],
  equipment: ["barbell"],
  primaryMuscleGroupLabels: ["Chest"],
  secondaryMuscleGroupLabels: ["Triceps"],
  equipmentLabels: ["Barbell"],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: true,
  createdBy: "user-1",
};

function setup(
  overrides: Partial<React.ComponentProps<typeof ExerciseEditorPresenter>> = {},
) {
  const props = {
    exercise,
    isLoading: false,
    error: null,
    isOwner: true,
    onClose: jest.fn(),
    onSave: jest.fn().mockResolvedValue(undefined),
    onRetry: jest.fn(),
    ...overrides,
  };
  return { props, ...renderWithTheme(<ExerciseEditorPresenter {...props} />) };
}

describe("ExerciseEditorPresenter", () => {
  afterEach(() => jest.useRealTimers());

  it("seeds the form from the loaded exercise (name + instructions)", () => {
    const { getByTestId } = setup();
    expect(getByTestId("exercise-form-name").props.value).toBe("Bench Press");
    expect(getByTestId("exercise-form-instructions").props.value).toBe(
      "Tuck elbows",
    );
  });

  it("does not auto-focus the name field (editor opens populated)", () => {
    const { getByTestId } = setup();
    expect(getByTestId("exercise-form-name").props.autoFocus).toBe(false);
  });

  it("saves the current value, shows the affirmation, then closes", async () => {
    jest.useFakeTimers();
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const { getByTestId, getByText } = setup({ onSave, onClose });

    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-save"));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(getByText("Saved ✓")).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(SAVED_AFFIRMATION_MS);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("guards against a double-tap submitting twice", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = setup({ onSave });
    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-save"));
      fireEvent.press(getByTestId("exercise-editor-save"));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps the screen open and re-arms Save when onSave rejects", async () => {
    const onSave = jest.fn().mockRejectedValue(new Error("nope"));
    const onClose = jest.fn();
    const { getByTestId, getByText } = setup({ onSave, onClose });

    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-save"));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(getByText("Save changes")).toBeTruthy();

    // Re-armed: a second tap fires onSave again.
    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-save"));
    });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("does not submit while the name is empty", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = setup({
      exercise: { ...exercise, name: "   " },
      onSave,
    });
    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-save"));
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Cancel and Back both close once", async () => {
    const onClose = jest.fn();
    const { getByTestId, getByLabelText } = setup({ onClose });
    fireEvent.press(getByTestId("exercise-editor-cancel"));
    fireEvent.press(getByLabelText("Back"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a read-only notice for a non-owner instead of the form", () => {
    const { getByTestId, queryByTestId } = setup({ isOwner: false });
    expect(getByTestId("exercise-editor-readonly")).toBeTruthy();
    expect(queryByTestId("exercise-form-name")).toBeNull();
  });

  it("renders the loading state when loading with no exercise", () => {
    const { getByTestId } = setup({ exercise: null, isLoading: true });
    expect(getByTestId("exercise-editor-loading")).toBeTruthy();
  });

  it("renders the error state with a retry that fires onRetry", () => {
    const { props, getByTestId } = setup({
      exercise: null,
      error: { kind: "api", code: "server", message: "down" },
    });
    fireEvent.press(getByTestId("exercise-editor-retry"));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("renders the not-found state when there's no exercise, error or load", () => {
    const { getByTestId } = setup({ exercise: null });
    expect(getByTestId("exercise-editor-empty")).toBeTruthy();
  });
});
