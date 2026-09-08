import { fireEvent } from "@testing-library/react-native";
import { AccessibilityInfo, StyleSheet } from "react-native";
import React from "react";
import {
  ActiveSessionPresenter,
  retrospectiveDayValue,
} from "../ActiveSessionPresenter";
import type { SessionExercise } from "@/domain/models/session";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { reorderableTestApi } from "../../../../__tests__/reorderable-test-api";

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

  it("collapses on the hold, commits on the drop, and expands again", () => {
    // ONE gesture: the hold collapses the rows so the list can be seen at a
    // glance, the same finger drags, and the drop commits and puts the cards
    // back. Nothing is tapped, in or out. The collapse fires BEFORE the drag
    // activates on purpose — see `ReorderableList`.
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

    expect(getByTestId("active-session-screen").props.style).toContainEqual({
      paddingTop: 44,
    });
    // At rest: the real cards, and no reorder control of any kind.
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(queryByTestId("active-session-reorder")).toBeNull();
    expect(queryByTestId("compact-reorder-row")).toBeNull();

    reorderableTestApi.collapse("se-1");
    expect(getAllByTestId("compact-reorder-row")).toHaveLength(3);
    expect(queryByTestId("session-exercise-se-1")).toBeNull();
    // Finish is never replaced by a Done button.
    expect(getByTestId("active-session-finish")).toBeTruthy();

    reorderableTestApi.dragStart("se-1");
    reorderableTestApi.drop("se-1", 2, { "se-1": 2, "se-2": 0, "se-3": 1 });

    expect(onReorderExercise).toHaveBeenCalledWith("se-1", 2);
    expect(announce).toHaveBeenCalledWith(
      "Bench Press moved to position 3 of 3",
    );
    // Back to the cards on the drop — no way to be left stranded in compact.
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(queryByTestId("compact-reorder-row")).toBeNull();
  });

  it("puts the rows back when a hold never becomes a drag", () => {
    // A press that collapsed the list but never dragged has to undo itself, or
    // a tap on the grip would leave the list compact with nothing to restore
    // it. The drop covers a pan that activated; this covers one that did not.
    const props = {
      ...baseProps,
      onReorderExercise: jest.fn(),
      exercises: [
        buildExercise({ id: "se-1" }),
        buildExercise({ id: "se-2", sortOrder: 1 }),
      ],
    };
    const { getAllByTestId, getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );

    reorderableTestApi.collapse("se-1");
    expect(getAllByTestId("compact-reorder-row")).toHaveLength(2);

    reorderableTestApi.collapseEnd("se-1");

    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(queryByTestId("compact-reorder-row")).toBeNull();
  });

  it("commits nothing, and still expands, when the drop changes nothing", () => {
    const onReorderExercise = jest.fn();
    const props = {
      ...baseProps,
      onReorderExercise,
      exercises: [
        buildExercise({ id: "se-1" }),
        buildExercise({ id: "se-2", sortOrder: 1 }),
      ],
    };
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );

    reorderableTestApi.collapse("se-1");
    reorderableTestApi.dragStart("se-1");
    // Released in its own slot.
    reorderableTestApi.drop("se-1", 0, { "se-1": 0, "se-2": 1 });

    expect(onReorderExercise).not.toHaveBeenCalled();
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(queryByTestId("compact-reorder-row")).toBeNull();
  });

  it("ignores a drop from a pan that never activated", () => {
    // Gesture Handler finalizes FAILED and CANCELLED pans too, and the library
    // forwards those as drops — a tap, or a scroll swipe starting on the grip.
    const onReorderExercise = jest.fn();
    const props = {
      ...baseProps,
      onReorderExercise,
      exercises: [
        buildExercise({ id: "se-1" }),
        buildExercise({ id: "se-2", sortOrder: 1 }),
      ],
    };
    renderWithTheme(<ActiveSessionPresenter {...props} />);

    // No `dragStart`.
    reorderableTestApi.drop("se-1", 1, { "se-1": 1, "se-2": 0 });

    expect(onReorderExercise).not.toHaveBeenCalled();
  });

  it("keeps drag rows in the command's index space when a superset holds cardio", () => {
    // `buildDisplayItems` splits a cardio-bearing superset into separate
    // DISPLAY rows, but the reorder command groups purely by supersetGroup.
    // Deriving drag rows from the display items handed the command an index
    // from the wrong space — silently no-oping past the end, or landing the
    // row after the wrong exercise.
    const onReorderExercise = jest.fn();
    const props = {
      ...baseProps,
      onReorderExercise,
      templateByExercise: {
        "se-2": { restSeconds: 90, category: "cardio" as const },
      },
      exercises: [
        buildExercise({ id: "se-1" }),
        buildExercise({ id: "se-2", sortOrder: 1, supersetGroup: 1 }),
        buildExercise({ id: "se-3", sortOrder: 2, supersetGroup: 1 }),
        buildExercise({ id: "se-4", sortOrder: 3 }),
      ],
    };
    const { getAllByTestId, getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );

    reorderableTestApi.collapse("se-1");

    // THREE blocks, matching the command: se-1, the group, se-4 — even though
    // the full-card view renders the cardio peers as separate rows.
    expect(getAllByTestId("compact-reorder-row")).toHaveLength(3);
    expect(getByTestId("sortable-item-superset-1")).toBeTruthy();

    reorderableTestApi.dragStart("se-1");
    reorderableTestApi.drop("se-1", 2, {
      "se-1": 2,
      "superset-1": 0,
      "se-4": 1,
    });

    // A valid block index, so the command can act on it.
    expect(onReorderExercise).toHaveBeenCalledWith("se-1", 2);
  });

  it("maps a dropped superset back to its lead exercise", () => {
    const onReorderExercise = jest.fn();
    const props = {
      ...baseProps,
      onReorderExercise,
      exercises: [
        buildExercise({ id: "se-1", supersetGroup: 1 }),
        buildExercise({ id: "se-2", sortOrder: 1, supersetGroup: 1 }),
        buildExercise({ id: "se-3", sortOrder: 2 }),
      ],
    };
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );

    // The block's row id is the superset key, but the command takes the LEAD
    // exercise — two index spaces that used to be converted twice.
    reorderableTestApi.dragStart("superset-1");
    reorderableTestApi.drop("superset-1", 1, {
      "superset-1": 1,
      "se-3": 0,
    });

    expect(onReorderExercise).toHaveBeenCalledWith("se-1", 1);
  });

  it("puts the drag on its own target, so set inputs still work", () => {
    const props = {
      ...baseProps,
      onReorderExercise: jest.fn(),
      exercises: [
        buildExercise({ id: "se-1" }),
        buildExercise({ id: "se-2", sortOrder: 1 }),
      ],
    };
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter {...props} />,
    );

    // The drag target is its own view over the row's corner, not the row: a
    // card-wide pan would fight the weight and reps TextInputs. It also sits
    // OUTSIDE the body, so the collapse cannot unmount it mid-gesture.
    expect(getByTestId("sortable-handle-se-1")).toBeTruthy();
    expect(getByTestId("sortable-handle-se-2")).toBeTruthy();
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

  it("makes a large superset ONE draggable row, led by its first exercise", () => {
    const onReorderExercise = jest.fn();
    const props = {
      ...baseProps,
      onMoveExercise: jest.fn(),
      onReorderExercise,
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

    // Grouped as one block while idle...
    expect(getByTestId("superset-group-7")).toBeTruthy();
    // The block's row id is the superset key — se-1..se-4 are all inside it.
    reorderableTestApi.collapse("superset-7");

    // ...and still one row once collapsed: the block moves as a unit.
    expect(getAllByTestId("compact-reorder-row")).toHaveLength(2);
    expect(getByTestId("sortable-item-superset-7")).toBeTruthy();
    expect(getByTestId("sortable-item-se-5")).toBeTruthy();
    expect(queryByTestId("sortable-item-se-2")).toBeNull();

    reorderableTestApi.dragStart("superset-7");
    reorderableTestApi.drop("superset-7", 1, {
      "superset-7": 1,
      "se-5": 0,
    });

    expect(onReorderExercise).toHaveBeenCalledWith("se-1", 1);
  });

  it("offers NO reorder button — the grip is the whole affordance", () => {
    // The button existed only to enter a mode. Holding the grip drags
    // directly now, so a separate control would be a second way to do
    // nothing.
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

    // Asserting the old button testIDs is worthless now they are deleted —
    // `queryByTestId` matches exactly, so those assertions pass whatever the
    // presenter renders. Assert the grip's own contract instead: it is the
    // ONLY way in, and it announces a hold rather than a button.
    // No `onMoveExercise` on these props, so the grip drags and offers no
    // VoiceOver Move actions — and says exactly that.
    const grip = getByTestId("reorder-1");
    expect(grip.props.accessibilityHint).toBe("Hold and drag to move");
    // Add Exercise is still there, and so is Finish.
    expect(getByTestId("active-session-add-exercise")).toBeTruthy();
    expect(getByTestId("active-session-finish")).toBeTruthy();
  });

  it("shows no grip at all on a one-block list", () => {
    // One exercise: nothing to move, so the card renders no handle. This
    // asserted a deleted testID, so it passed unconditionally and left the
    // path untested.
    const { queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={jest.fn()}
        exercises={[buildExercise({ id: "se-1" })]}
      />,
    );

    expect(queryByTestId("reorder-1")).toBeNull();
    expect(queryByTestId("active-session-reorder-list")).toBeNull();
  });

  it("shows no grip on a one-block list even with the move handler wired", () => {
    // Production always wires `onMoveExercise`, so the card's own guard passes
    // and the grip used to render at "position 1 of 1" with empty action
    // filters: a drag affordance that cannot drag, and an `adjustable` control
    // whose VoiceOver swipes were silent no-ops.
    const { queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={jest.fn()}
        onMoveExercise={jest.fn()}
        exercises={[buildExercise({ id: "se-1" })]}
      />,
    );

    expect(queryByTestId("reorder-1")).toBeNull();
  });

  it("offers no reorder at all without a commit callback", () => {
    // Two blocks, but every drop would be swallowed by
    // `onReorderExercise?.()`, so there is no mode to enter — and with no
    // Move actions either, no grip is rendered at all.
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={undefined}
        exercises={[
          buildExercise({ id: "se-1" }),
          buildExercise({ id: "se-2", sortOrder: 1 }),
        ]}
      />,
    );

    expect(queryByTestId("reorder-1")).toBeNull();
    expect(queryByTestId("active-session-reorder-list")).toBeNull();
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

  it("renders and updates retrospective cardio metadata", () => {
    const onActivityEnvironmentChange = jest.fn();
    const onLocationNameChange = jest.fn();
    const onRetrospectiveDurationChange = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        retroactive
        retrospectiveCompletedAt="2026-05-04T12:00:00.000Z"
        retrospectiveDurationSeconds={1_800}
        onRetrospectiveDateChange={jest.fn()}
        onRetrospectiveDurationChange={onRetrospectiveDurationChange}
        activityEnvironment="indoor"
        onActivityEnvironmentChange={onActivityEnvironmentChange}
        locationName="Track"
        onLocationNameChange={onLocationNameChange}
        templateByExercise={{ "se-1": { category: "cardio", restSeconds: 90 } }}
      />,
    );

    expect(getByText("ENVIRONMENT")).toBeTruthy();
    fireEvent.changeText(getByTestId("retrospective-workout-duration"), "45");
    expect(onRetrospectiveDurationChange).toHaveBeenCalledWith(2_700);
    fireEvent.press(getByTestId("session-environment-outdoor"));
    expect(onActivityEnvironmentChange).toHaveBeenCalledWith("outdoor");
    fireEvent.changeText(getByTestId("session-location"), "Park");
    expect(onLocationNameChange).toHaveBeenCalledWith("Park");
  });

  it("derives the retrospective picker day from local calendar components", () => {
    jest.spyOn(Date.prototype, "getFullYear").mockReturnValue(2026);
    jest.spyOn(Date.prototype, "getMonth").mockReturnValue(5);
    jest.spyOn(Date.prototype, "getDate").mockReturnValue(5);

    expect(retrospectiveDayValue("2026-06-04T23:00:00.000Z")).toBe(
      "2026-06-05",
    );
  });

  it("does not force metric loggers into the strength-only superset table", () => {
    const exercises = [
      buildExercise({ id: "run", category: "cardio", supersetGroup: 2 }),
      buildExercise({
        id: "jumps",
        exerciseId: "jumps",
        exerciseName: "Box Jumps",
        category: "plyometric",
        supersetGroup: 2,
        sortOrder: 1,
      }),
    ];
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        exercises={exercises}
        templateByExercise={{
          run: { category: "cardio", restSeconds: 90 },
          jumps: { category: "plyometric", restSeconds: 90 },
        }}
      />,
    );
    expect(queryByTestId("superset-group-2")).toBeNull();
    expect(getByTestId("session-exercise-run")).toBeTruthy();
    expect(getByTestId("session-exercise-jumps")).toBeTruthy();
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
