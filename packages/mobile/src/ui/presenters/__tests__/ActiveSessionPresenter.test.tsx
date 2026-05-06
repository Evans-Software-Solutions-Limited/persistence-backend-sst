import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { ActiveSessionPresenter } from "../ActiveSessionPresenter";
import type { SessionExercise } from "@/domain/models/session";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const buildExercise = (
  overrides: Partial<SessionExercise> = {},
): SessionExercise => ({
  id: overrides.id ?? "se-1",
  sessionId: "local-1",
  exerciseId: overrides.exerciseId ?? "ex-bench",
  exerciseName: overrides.exerciseName ?? "Bench Press",
  sortOrder: overrides.sortOrder ?? 0,
  supersetGroup: null,
  isSubstituted: overrides.isSubstituted ?? false,
  originalExerciseId: null,
  notes: null,
  sets: overrides.sets ?? [],
});

const baseRestTimer = {
  isActive: false,
  remainingSeconds: 0,
  totalSeconds: 0,
  progress: 0,
  onSkip: jest.fn(),
  onExtend: jest.fn(),
  onDismiss: jest.fn(),
};

const baseProps = {
  sessionName: "Push Day",
  startedAt: "2026-05-05T10:00:00.000Z",
  exercises: [buildExercise()],
  previousByExercise: {},
  restTimer: baseRestTimer,
  onClose: jest.fn(),
  onLogSet: jest.fn(),
  onCompleteSet: jest.fn(),
  onUpdateSet: jest.fn(),
  onRemoveSet: jest.fn(),
  onSubstitute: jest.fn(),
  onTapExercise: jest.fn(),
  onAddExercise: jest.fn(),
  onDiscard: jest.fn(),
  onFinish: jest.fn(),
  pageWidth: 390,
};

describe("ActiveSessionPresenter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the empty-state Add CTA with no exercises and fires onAddExercise", () => {
    const props = { ...baseProps, exercises: [] };
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    expect(getByTestId("active-session-empty")).toBeTruthy();
    fireEvent.press(getByTestId("active-session-empty-add"));
    expect(props.onAddExercise).toHaveBeenCalledTimes(1);
  });

  it("renders the tab strip with multiple exercises", () => {
    const props = {
      ...baseProps,
      exercises: [
        buildExercise({ id: "se-1", exerciseId: "ex-bench" }),
        buildExercise({
          id: "se-2",
          exerciseId: "ex-row",
          exerciseName: "Row",
          sortOrder: 1,
        }),
      ],
    };
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    expect(getByTestId("exercise-tab-strip")).toBeTruthy();
    expect(getByTestId("exercise-tab-0")).toBeTruthy();
    expect(getByTestId("exercise-tab-1")).toBeTruthy();
  });

  it("tap-strip jumpTo bounds-checks: pressing a tab in range scrolls without crashing", () => {
    const props = {
      ...baseProps,
      exercises: [
        buildExercise({ id: "se-1" }),
        buildExercise({ id: "se-2", sortOrder: 1 }),
      ],
    };
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    fireEvent.press(getByTestId("exercise-tab-1"));
    // Re-render is internal — assert the screen still mounts.
    expect(getByTestId("active-session-screen")).toBeTruthy();
  });

  it("renders the substituted-rows note when at least one exercise is substituted", () => {
    const props = {
      ...baseProps,
      exercises: [
        buildExercise({ id: "se-1", isSubstituted: true }),
        buildExercise({
          id: "se-2",
          exerciseId: "ex-incline",
          exerciseName: "Incline",
          sortOrder: 1,
        }),
      ],
    };
    const { getByTestId, getByText } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    expect(getByTestId("substituted-note")).toBeTruthy();
    expect(getByText(/1 substituted exercise/)).toBeTruthy();
  });

  it("pluralises the substituted note when multiple are substituted", () => {
    const props = {
      ...baseProps,
      exercises: [
        buildExercise({ id: "se-1", isSubstituted: true }),
        buildExercise({ id: "se-2", isSubstituted: true, sortOrder: 1 }),
        buildExercise({
          id: "se-3",
          exerciseId: "ex-row",
          exerciseName: "Row",
          sortOrder: 2,
        }),
      ],
    };
    const { getByText } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    expect(getByText(/2 substituted exercises/)).toBeTruthy();
  });

  it("Discard footer button opens the confirmation Popover and Cancel returns", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...baseProps} />,
    );
    fireEvent.press(getByTestId("active-session-discard"));
    fireEvent.press(getByTestId("active-session-discard-cancel"));
    expect(baseProps.onDiscard).not.toHaveBeenCalled();
    expect(queryByTestId("active-session-screen")).toBeTruthy();
  });

  it("RestTimerDisplay renders when restTimer.isActive", () => {
    const props = {
      ...baseProps,
      restTimer: {
        ...baseRestTimer,
        isActive: true,
        remainingSeconds: 60,
        totalSeconds: 90,
        progress: 0.33,
      },
    };
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    expect(getByTestId("rest-timer-display")).toBeTruthy();
  });
});
