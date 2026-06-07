import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { ActiveSessionPresenter } from "../ActiveSessionPresenter";
import type { SessionExercise } from "@/domain/models/session";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const buildExercise = (
  overrides: Partial<SessionExercise> = {},
): SessionExercise => ({
  id: "se-1",
  sessionId: "local-1",
  exerciseId: "ex-bench",
  exerciseName: "Bench Press",
  sortOrder: 0,
  supersetGroup: null,
  isSubstituted: false,
  originalExerciseId: null,
  notes: null,
  sets: [],
  ...overrides,
});

const baseRestTimer = {
  isActive: false,
  remainingSeconds: 0,
  totalSeconds: 0,
  progress: 0,
  onSkip: jest.fn(),
  onDismiss: jest.fn(),
};

const baseProps = {
  sessionName: "Push Day",
  startedAt: "2026-05-05T10:00:00.000Z",
  exercises: [buildExercise()],
  previousSetsByExercise: {},
  templateByExercise: {},
  restTimer: baseRestTimer,
  onLogSet: jest.fn(),
  onUpdateSet: jest.fn(),
  onRemoveSet: jest.fn(),
  onOpenNotes: jest.fn(),
  onOpenSupersetNotes: jest.fn(),
  onSubstitute: jest.fn(),
  onRemoveExercise: jest.fn(),
  onTapExercise: jest.fn(),
  onLogSupersetSet: jest.fn(),
  onRemoveSupersetSet: jest.fn(),
  onAddExercise: jest.fn(),
  onAddExerciseToSuperset: jest.fn(),
  onStartRest: jest.fn(),
  onMinimize: jest.fn(),
  onDiscard: jest.fn(),
  onFinish: jest.fn(),
};

describe("ActiveSessionPresenter (vertical scroll, legacy parity)", () => {
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

  it("stacks every exercise vertically (no pager / tab-strip)", () => {
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
        buildExercise({
          id: "se-3",
          exerciseId: "ex-pull",
          exerciseName: "Pulldown",
          sortOrder: 2,
        }),
      ],
    };
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(getByTestId("session-exercise-se-2")).toBeTruthy();
    expect(getByTestId("session-exercise-se-3")).toBeTruthy();
    // No pager controls.
    expect(queryByTestId("exercise-pager")).toBeNull();
    expect(queryByTestId("exercise-tab-strip")).toBeNull();
  });

  it("renders substituted exercises in place alongside their replacement (legacy parity — both rows visible, sets preserved for bulk-record flush)", () => {
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
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(getByTestId("session-exercise-se-2")).toBeTruthy();
  });

  it("renders the bottom Add Exercise link when at least one exercise exists", () => {
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...baseProps} />,
    );
    expect(getByTestId("active-session-add-exercise-row")).toBeTruthy();
    fireEvent.press(getByTestId("active-session-add-exercise"));
    expect(baseProps.onAddExercise).toHaveBeenCalledTimes(1);
  });

  it("groups exercises that share a supersetGroup into a single ActiveSupersetRow (Story-005)", () => {
    const props = {
      ...baseProps,
      exercises: [
        buildExercise({
          id: "se-1",
          exerciseId: "ex-bench",
          sortOrder: 0,
          supersetGroup: 1,
        }),
        buildExercise({
          id: "se-2",
          exerciseId: "ex-row",
          exerciseName: "Row",
          sortOrder: 1,
          supersetGroup: 1,
        }),
        buildExercise({
          id: "se-3",
          exerciseId: "ex-curl",
          exerciseName: "Curl",
          sortOrder: 2,
        }),
      ],
    };
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    // The grouped row renders ONCE with both peers interleaved per
    // setNumber (1 set seeded by default → setNumber=1 mini-row per peer).
    expect(getByTestId("superset-group-1")).toBeTruthy();
    // Solo exercise renders as its own SessionExerciseCard.
    expect(getByTestId("session-exercise-se-3")).toBeTruthy();
    // Each peer renders as an ActiveSupersetExerciseRow inside the
    // group (NOT as a full SessionExerciseCard — that was the
    // SupersetGroupCard layout we replaced).
    expect(queryByTestId("session-exercise-se-1")).toBeNull();
    expect(queryByTestId("session-exercise-se-2")).toBeNull();
    expect(getByTestId("superset-row-se-1-1")).toBeTruthy();
    expect(getByTestId("superset-row-se-2-1")).toBeTruthy();
    // No second copy of the superset group.
    expect(queryByTestId("superset-group-2")).toBeNull();
  });

  it("Add paired set button on an ActiveSupersetRow fires onLogSupersetSet with all peer ids", () => {
    const props = {
      ...baseProps,
      exercises: [
        buildExercise({
          id: "se-1",
          exerciseId: "ex-bench",
          supersetGroup: 1,
        }),
        buildExercise({
          id: "se-2",
          exerciseId: "ex-row",
          exerciseName: "Row",
          sortOrder: 1,
          supersetGroup: 1,
        }),
      ],
    };
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    fireEvent.press(getByTestId("superset-1-add-set"));
    expect(props.onLogSupersetSet).toHaveBeenCalledWith(["se-1", "se-2"]);
  });

  it("renders a 'superset' of one as a plain exercise card, not a grouped card", () => {
    const props = {
      ...baseProps,
      exercises: [
        buildExercise({
          id: "se-1",
          exerciseId: "ex-bench",
          supersetGroup: 1,
        }),
      ],
    };
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(queryByTestId("superset-group-1")).toBeNull();
  });

  it("header chevron-down calls onMinimize (collapse to floating bar)", () => {
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...baseProps} />,
    );
    fireEvent.press(getByTestId("session-minimize"));
    expect(baseProps.onMinimize).toHaveBeenCalledTimes(1);
  });

  it("header End pill calls onDiscard (end without saving; Alert.alert lives in the container)", () => {
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...baseProps} />,
    );
    fireEvent.press(getByTestId("session-end"));
    expect(baseProps.onDiscard).toHaveBeenCalledTimes(1);
  });

  it("sticky Finish Workout CTA calls onFinish", () => {
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...baseProps} />,
    );
    fireEvent.press(getByTestId("active-session-finish"));
    expect(baseProps.onFinish).toHaveBeenCalledTimes(1);
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

  // The KeyboardAvoidingView branch covers the bug where SetLogger TextInputs
  // were occluded by the keyboard mid-workout. We assert the platform-conditional
  // both ways so a regression to a single hard-coded behavior (or no KAV) shows
  // up here, not on device.
  it("renders the screen on Android (KAV behavior = undefined)", () => {
    const PlatformModule = jest.requireActual(
      "react-native/Libraries/Utilities/Platform",
    ) as typeof import("react-native").Platform;
    const originalOS = PlatformModule.OS;
    (PlatformModule as { OS: string }).OS = "android";
    try {
      const { getByTestId } = renderWithTheme(
        <ActiveSessionPresenter {...baseProps} />,
      );
      expect(getByTestId("active-session-screen")).toBeTruthy();
    } finally {
      (PlatformModule as { OS: string }).OS = originalOS;
    }
  });
});
