import { fireEvent } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
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

  it("a partner's view replaces your list and Finish, keeping the header and strip (PER-60 row 2)", () => {
    const { Text } = jest.requireActual("react-native");
    const { getByTestId, queryByTestId, getByText, rerender } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        togetherRow={<Text>strip</Text>}
        partnerView={<Text>Mia’s workout</Text>}
      />,
    );
    expect(getByTestId("active-session-partner-list")).toBeTruthy();
    expect(getByTestId("session-header")).toBeTruthy();
    expect(getByText("strip")).toBeTruthy();
    expect(getByText("Mia’s workout")).toBeTruthy();
    expect(queryByTestId("session-exercise-se-1")).toBeNull();
    expect(queryByTestId("active-session-finish")).toBeNull();
    fireEvent.press(getByTestId("session-minimize"));
    expect(baseProps.onMinimize).toHaveBeenCalledTimes(1);
    rerender(
      <ActiveSessionPresenter
        {...baseProps}
        togetherRow={<Text>strip</Text>}
      />,
    );
    expect(queryByTestId("active-session-partner-list")).toBeNull();
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(getByTestId("active-session-finish")).toBeTruthy();
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

  // Reorder mode (PER-67, Brad 10 Nov 2026): a Reorder button above the
  // exercises, compact rows with drag handles, Done to leave. Outside the mode
  // nothing on a card starts a drag.
  const twoOrThree = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      buildExercise({ id: `se-${i + 1}`, sortOrder: i }),
    );

  it("enters reorder mode from the Reorder button, commits a drop and leaves on Done", () => {
    const onReorderExercise = jest.fn();
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(jest.fn());
    const { getAllByTestId, getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={onReorderExercise}
        exercises={twoOrThree(3)}
      />,
    );

    expect(getByTestId("active-session-screen").props.style).toContainEqual({
      paddingTop: 44,
    });
    // At rest: the real cards, no drag rows, no drag handles.
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(queryByTestId("active-session-reorder")).toBeNull();
    expect(queryByTestId("compact-reorder-row")).toBeNull();
    expect(queryByTestId("sortable-handle-se-1")).toBeNull();

    fireEvent.press(getByTestId("reorder-exercises"));

    expect(getAllByTestId("compact-reorder-row")).toHaveLength(3);
    expect(getByTestId("sortable-handle-se-1")).toBeTruthy();
    expect(queryByTestId("session-exercise-se-1")).toBeNull();

    reorderableTestApi.dragStart("se-1");
    reorderableTestApi.drop("se-1", 2, { "se-1": 2, "se-2": 0, "se-3": 1 });

    expect(onReorderExercise).toHaveBeenCalledWith("se-1", 2);
    expect(announce).toHaveBeenCalledWith(
      "Bench Press moved to position 3 of 3",
    );
    // A drop does not leave the mode: more moves can follow until Done.
    expect(getAllByTestId("compact-reorder-row")).toHaveLength(3);

    fireEvent.press(getByTestId("reorder-mode-bar-done"));

    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(queryByTestId("compact-reorder-row")).toBeNull();
  });

  // PER-67 and Brad's "two sets" report: with the old hold-to-collapse grip,
  // logging sets or removing an exercise could leave some cards collapsed.
  // At rest the list now holds no drag code at all.
  it("never leaves reorder mode half-entered: logging sets and removing an exercise keep the cards", () => {
    const onRemoveExercise = jest.fn();
    const { getAllByTestId, getByTestId, queryByTestId, rerender } =
      renderWithTheme(
        <ActiveSessionPresenter
          {...baseProps}
          onReorderExercise={jest.fn()}
          onRemoveExercise={onRemoveExercise}
          exercises={[
            buildExercise({
              id: "se-1",
              sets: [
                {
                  id: "s1",
                  sessionExerciseId: "se-1",
                  setNumber: 1,
                  weightKg: 60,
                  reps: 8,
                  rpe: null,
                  durationSeconds: null,
                  distanceMeters: null,
                  isCompleted: false,
                  completedAt: null,
                },
                {
                  id: "s2",
                  sessionExerciseId: "se-1",
                  setNumber: 2,
                  weightKg: 60,
                  reps: 8,
                  rpe: null,
                  durationSeconds: null,
                  distanceMeters: null,
                  isCompleted: false,
                  completedAt: null,
                },
              ],
            }),
            buildExercise({ id: "se-2", sortOrder: 1 }),
            buildExercise({ id: "se-3", sortOrder: 2 }),
          ]}
        />,
      );

    expect(queryByTestId("compact-reorder-row")).toBeNull();
    // Log into both sets of the first exercise.
    fireEvent.changeText(getAllByTestId("set-logger-reps")[0]!, "10");
    fireEvent.changeText(getAllByTestId("set-logger-reps")[1]!, "9");
    expect(baseProps.onUpdateSet).toHaveBeenCalledTimes(2);
    expect(queryByTestId("compact-reorder-row")).toBeNull();
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();

    fireEvent.press(getAllByTestId("session-exercise-remove")[1]!);
    expect(onRemoveExercise).toHaveBeenCalledWith("se-2");

    rerender(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={jest.fn()}
        exercises={[
          buildExercise({ id: "se-1" }),
          buildExercise({ id: "se-3", sortOrder: 2 }),
        ]}
      />,
    );

    expect(getAllByTestId(/^session-exercise-se-/)).toHaveLength(2);
    expect(queryByTestId("compact-reorder-row")).toBeNull();
    expect(queryByTestId("active-session-reorder")).toBeNull();
  });

  it("leaves reorder mode by itself when only one block is left", () => {
    const { getByTestId, queryByTestId, rerender } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={jest.fn()}
        exercises={twoOrThree(2)}
      />,
    );
    fireEvent.press(getByTestId("reorder-exercises"));
    expect(getByTestId("active-session-reorder")).toBeTruthy();

    rerender(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={jest.fn()}
        exercises={[buildExercise({ id: "se-1" })]}
      />,
    );

    expect(queryByTestId("active-session-reorder")).toBeNull();
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
  });

  it("commits nothing when the drop changes nothing", () => {
    const onReorderExercise = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={onReorderExercise}
        exercises={twoOrThree(2)}
      />,
    );
    fireEvent.press(getByTestId("reorder-exercises"));

    reorderableTestApi.dragStart("se-1");
    reorderableTestApi.drop("se-1", 0, { "se-1": 0, "se-2": 1 });

    expect(onReorderExercise).not.toHaveBeenCalled();
  });

  it("ignores a drop from a pan that never activated", () => {
    // Gesture Handler finalizes FAILED and CANCELLED pans too, and the library
    // forwards those as drops: a tap, or a scroll swipe starting on a handle.
    const onReorderExercise = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={onReorderExercise}
        exercises={twoOrThree(2)}
      />,
    );
    fireEvent.press(getByTestId("reorder-exercises"));

    reorderableTestApi.drop("se-1", 1, { "se-1": 1, "se-2": 0 });

    expect(onReorderExercise).not.toHaveBeenCalled();
  });

  it("keeps reorder rows in the command's index space when a superset holds cardio", () => {
    // `buildDisplayItems` splits a cardio-bearing superset into separate
    // DISPLAY rows, but the reorder command groups purely by supersetGroup.
    const onReorderExercise = jest.fn();
    const { getAllByTestId, getByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={onReorderExercise}
        templateByExercise={{
          "se-2": { restSeconds: 90, category: "cardio" as const },
        }}
        exercises={[
          buildExercise({ id: "se-1" }),
          buildExercise({ id: "se-2", sortOrder: 1, supersetGroup: 1 }),
          buildExercise({ id: "se-3", sortOrder: 2, supersetGroup: 1 }),
          buildExercise({ id: "se-4", sortOrder: 3 }),
        ]}
      />,
    );
    fireEvent.press(getByTestId("reorder-exercises"));

    // THREE blocks, matching the command, even though the cards render the
    // cardio peers as separate rows.
    expect(getAllByTestId("compact-reorder-row")).toHaveLength(3);
    expect(getByTestId("sortable-item-superset-1")).toBeTruthy();

    reorderableTestApi.dragStart("se-1");
    reorderableTestApi.drop("se-1", 2, {
      "se-1": 2,
      "superset-1": 0,
      "se-4": 1,
    });

    expect(onReorderExercise).toHaveBeenCalledWith("se-1", 2);
  });

  it("maps a dropped superset back to its lead exercise", () => {
    const onReorderExercise = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={onReorderExercise}
        exercises={[
          buildExercise({ id: "se-1", supersetGroup: 1 }),
          buildExercise({ id: "se-2", sortOrder: 1, supersetGroup: 1 }),
          buildExercise({ id: "se-3", sortOrder: 2 }),
        ]}
      />,
    );
    fireEvent.press(getByTestId("reorder-exercises"));

    reorderableTestApi.dragStart("superset-1");
    reorderableTestApi.drop("superset-1", 1, {
      "superset-1": 1,
      "se-3": 0,
    });

    expect(onReorderExercise).toHaveBeenCalledWith("se-1", 1);
  });

  it("offers VoiceOver Move up / Move down on the reorder rows", () => {
    const onMoveExercise = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={jest.fn()}
        onMoveExercise={onMoveExercise}
        exercises={twoOrThree(2)}
      />,
    );
    fireEvent.press(getByTestId("reorder-exercises"));

    const grip = getByTestId("reorder-2");
    expect(grip.props.accessibilityActions).toEqual([
      { name: "decrement", label: "Move up" },
    ]);
    fireEvent(grip, "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(onMoveExercise).toHaveBeenCalledWith("se-2", -1);
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

  it("makes a large superset ONE reorder row, led by its first exercise", () => {
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
    fireEvent.press(getByTestId("reorder-exercises"));

    // ...and one row in reorder mode: the block moves as a unit.
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

  it("puts no drag handle or grip on the cards", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={jest.fn()}
        onMoveExercise={jest.fn()}
        exercises={twoOrThree(2)}
      />,
    );

    expect(queryByTestId("reorder-1")).toBeNull();
    expect(queryByTestId("sortable-handle-se-1")).toBeNull();
    // Add Exercise and Finish are unchanged.
    expect(getByTestId("active-session-add-exercise")).toBeTruthy();
    expect(getByTestId("active-session-finish")).toBeTruthy();
  });

  it("offers no Reorder button on a one-block list", () => {
    const { queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={jest.fn()}
        onMoveExercise={jest.fn()}
        exercises={[buildExercise({ id: "se-1" })]}
      />,
    );

    expect(queryByTestId("reorder-exercises")).toBeNull();
  });

  it("offers no Reorder button without a commit callback", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={undefined}
        exercises={twoOrThree(2)}
      />,
    );

    expect(queryByTestId("reorder-exercises")).toBeNull();
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
  });

  it("offers no Reorder button on a partner's view", () => {
    const { queryByTestId } = renderWithTheme(
      <ActiveSessionPresenter
        {...baseProps}
        onReorderExercise={jest.fn()}
        exercises={twoOrThree(2)}
        partnerView={<></>}
      />,
    );

    expect(queryByTestId("reorder-exercises")).toBeNull();
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
