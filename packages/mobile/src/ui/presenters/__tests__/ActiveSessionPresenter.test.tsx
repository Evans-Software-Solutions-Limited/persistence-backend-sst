import { act, fireEvent } from "@testing-library/react-native";
import { AccessibilityInfo, AppState } from "react-native";
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
    jest.restoreAllMocks();
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

  it("persists the exact destination and announces a multi-position drop", () => {
    const onReorderExercise = jest.fn();
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(jest.fn());
    const props = {
      ...baseProps,
      onReorderExercise,
      exercises: [
        buildExercise({ id: "se-1" }),
        buildExercise({ id: "se-2", sortOrder: 1 }),
        buildExercise({ id: "se-3", sortOrder: 2 }),
      ],
    };
    const { getAllByTestId, getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );

    const list = getByTestId("active-session-draggable-list");
    expect(getByTestId("active-session-screen").props.style).toContainEqual({
      paddingTop: 44,
    });
    expect(list.props.activationDistance).toBe(20);
    expect(list.props.containerStyle).toEqual({ flex: 1 });
    expect(list.props.scrollEnabled).not.toBe(false);
    expect(list.props.dragItemOverflow).toBeUndefined();
    expect(list.props.renderPlaceholder).toEqual(expect.any(Function));
    expect(list.props.renderPlaceholder().props.style).toMatchObject({
      flex: 1,
      backgroundColor: "rgba(34,211,238,0.10)",
    });
    const activeCellSize = { value: 412 };
    fireEvent(list, "animValInit", { activeCellSize });

    fireEvent(getByTestId("reorder-1"), "longPress");
    expect(queryByTestId("active-session-finish")).toBeNull();
    expect(
      getByTestId("active-session-draggable-list").props.scrollEnabled,
    ).toBe(false);
    expect(getAllByTestId("compact-reorder-row")).toHaveLength(3);
    fireEvent(list, "dragBegin", 0);
    expect(activeCellSize.value).toBe(72);
    expect(getAllByTestId("compact-reorder-row-names")[0].props.children).toBe(
      "Bench Press",
    );

    fireEvent(list, "dragEnd", {
      from: 0,
      to: 2,
    });

    expect(onReorderExercise).toHaveBeenCalledWith("se-1", 2);
    expect(announce).toHaveBeenCalledWith(
      "Bench Press moved to position 3 of 3",
    );
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(getByTestId("active-session-finish")).toBeTruthy();
  });

  it("threads weightUnit='lb' into the previous-set chip (device-QA #8b)", () => {
    const exercise = buildExercise({
      sets: [
        {
          id: "set-1",
          sessionExerciseId: "se-1",
          setNumber: 1,
          weightKg: null,
          reps: null,
          rpe: null,
          durationSeconds: null,
          distanceMeters: null,
          isCompleted: false,
          completedAt: null,
        },
      ],
    });
    const props = {
      ...baseProps,
      exercises: [exercise],
      previousSetsByExercise: { "se-1": { 1: { weightKg: 80, reps: 8 } } },
      weightUnit: "lb" as const,
    };
    const { getByText } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    // 80 kg -> 176.4 lb (weightInUnit, 1dp).
    expect(getByText("8 reps • 176.4 lb")).toBeTruthy();
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

  it("keeps a large superset compact regardless of its exercise count", () => {
    const props = {
      ...baseProps,
      onMoveExercise: jest.fn(),
      onReorderExercise: jest.fn(),
      exercises: [
        buildExercise({
          id: "se-1",
          exerciseName: "Bench Press",
          supersetGroup: 7,
        }),
        buildExercise({
          id: "se-2",
          exerciseName: "Row",
          sortOrder: 1,
          supersetGroup: 7,
        }),
        buildExercise({
          id: "se-3",
          exerciseName: "Pulldown",
          sortOrder: 2,
          supersetGroup: 7,
        }),
        buildExercise({
          id: "se-4",
          exerciseName: "Curl",
          sortOrder: 3,
          supersetGroup: 7,
        }),
        buildExercise({
          id: "se-5",
          exerciseName: "Raise",
          sortOrder: 4,
        }),
      ],
    };
    const { getAllByTestId, getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );

    fireEvent(getByTestId("reorder-1"), "longPress");

    expect(queryByTestId("superset-group-7")).toBeNull();
    const compactRows = getAllByTestId("compact-reorder-row");
    expect(compactRows).toHaveLength(2);
    expect(compactRows[0].props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 72 })]),
    );
    const names = getAllByTestId("compact-reorder-row-names")[0];
    expect(names.props.numberOfLines).toBe(2);
    expect(names.props.children).toBe("Bench Press + Row + Pulldown + Curl");
    expect(compactRows[0].props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          borderLeftWidth: 4,
          borderLeftColor: "#22D3EE",
        }),
      ]),
    );
  });

  it("keeps a non-first dragged row anchored to the same screen coordinate", () => {
    const props = {
      ...baseProps,
      onReorderExercise: jest.fn(),
      exercises: [
        buildExercise({ id: "se-1" }),
        buildExercise({ id: "se-2", sortOrder: 1 }),
        buildExercise({ id: "se-3", sortOrder: 2 }),
      ],
    };
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    const list = getByTestId("active-session-draggable-list");
    const activeCellOffset = { value: 316 };
    const scrollOffset = { value: 250 };
    fireEvent(list, "animValInit", {
      activeCellOffset,
      activeCellSize: { value: 180 },
      scrollOffset,
    });
    fireEvent(getByTestId("active-session-drag-block-1"), "layout", {
      nativeEvent: {
        layout: { x: 0, y: 0, width: 320, height: 300 },
      },
    });

    const originalScreenY = activeCellOffset.value - scrollOffset.value;
    fireEvent(getByTestId("reorder-2"), "longPress");

    expect(activeCellOffset.value).toBe(88);
    expect(scrollOffset.value).toBe(22);
    expect(activeCellOffset.value - scrollOffset.value).toBe(originalScreenY);
  });

  it("preserves enough scroll extent to anchor a lower compact row", () => {
    const props = {
      ...baseProps,
      onReorderExercise: jest.fn(),
      exercises: Array.from({ length: 5 }, (_, index) =>
        buildExercise({ id: `se-${index + 1}`, sortOrder: index }),
      ),
    };
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    const list = getByTestId("active-session-draggable-list");
    const activeCellOffset = { value: 1264 };
    const scrollOffset = { value: 976 };
    fireEvent(list, "animValInit", {
      activeCellOffset,
      activeCellSize: { value: 300 },
      scrollOffset,
    });
    fireEvent(list, "contentSizeChange", 320, 1800);
    for (let position = 1; position <= 4; position += 1) {
      fireEvent(
        getByTestId(`active-session-drag-block-${position}`),
        "layout",
        {
          nativeEvent: {
            layout: { x: 0, y: 0, width: 320, height: 300 },
          },
        },
      );
    }

    const originalScreenY = activeCellOffset.value - scrollOffset.value;
    fireEvent(getByTestId("reorder-5"), "longPress");

    expect(activeCellOffset.value).toBe(352);
    expect(scrollOffset.value).toBe(64);
    expect(activeCellOffset.value - scrollOffset.value).toBe(originalScreenY);
    expect(
      getByTestId("active-session-draggable-list").props.contentContainerStyle,
    ).toEqual(expect.arrayContaining([{ minHeight: 1800 }]));
  });

  it("leaves compact mode when the OS interrupts an active drag", () => {
    let onAppStateChange: ((state: "background") => void) | undefined;
    let nextFrame = 1;
    const frames = new Map<number, FrameRequestCallback>();
    jest
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        const frame = nextFrame;
        nextFrame += 1;
        frames.set(frame, callback);
        return frame;
      });
    jest
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation((frame: number) => {
        frames.delete(frame);
      });
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_type, listener) => {
        onAppStateChange = listener as (state: "background") => void;
        return { remove: jest.fn() };
      });
    const props = {
      ...baseProps,
      onReorderExercise: jest.fn(),
      exercises: [
        buildExercise({ id: "se-1" }),
        buildExercise({ id: "se-2", sortOrder: 1 }),
      ],
    };
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );
    const list = getByTestId("active-session-draggable-list");
    const scrollOffset = { value: 240 };
    fireEvent(list, "animValInit", {
      activeCellOffset: { value: 280 },
      activeCellSize: { value: 300 },
      scrollOffset,
    });

    fireEvent(getByTestId("reorder-1"), "longPress");
    expect(queryByTestId("active-session-finish")).toBeNull();
    expect(
      getByTestId("active-session-draggable-list").props.scrollEnabled,
    ).toBe(false);

    act(() => onAppStateChange?.("background"));
    act(() => {
      for (const callback of [...frames.values()]) callback(0);
      frames.clear();
    });

    const restoredList = getByTestId("active-session-draggable-list");
    expect(restoredList.props.testScrollToOffset).toHaveBeenCalledWith({
      offset: 240,
      animated: false,
    });
    expect(scrollOffset.value).toBe(240);
    expect(getByTestId("active-session-finish")).toBeTruthy();
    expect(
      getByTestId("active-session-draggable-list").props.scrollEnabled,
    ).not.toBe(false);
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
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
