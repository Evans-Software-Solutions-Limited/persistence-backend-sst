import { fireEvent } from "@testing-library/react-native";
import React from "react";
import type {
  Workout,
  WorkoutExercise,
  WorkoutHistory,
} from "@/domain/models/workout";
import { WorkoutDetailPresenter } from "@/ui/presenters/WorkoutDetailPresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const buildExercise = (
  overrides: Partial<WorkoutExercise> = {},
): WorkoutExercise => ({
  id: "we-1",
  exerciseId: "ex-1",
  sortOrder: 1,
  supersetGroup: null,
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetDurationSeconds: null,
  restSeconds: 60,
  notes: null,
  exercise: {
    id: "ex-1",
    name: "Bench Press",
    category: "strength",
    difficultyLevel: "intermediate",
    videoUrl: null,
    thumbnailUrl: null,
  },
  ...overrides,
});

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: "w-1",
  name: "Push Day",
  description: "Heavy chest session",
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 45,
  showInOwnerLibrary: true,
  exercises: [buildExercise()],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
  ...overrides,
});

type Props = React.ComponentProps<typeof WorkoutDetailPresenter>;

function renderDetail(overrides: Partial<Props> = {}) {
  const props: Props = {
    workout: buildWorkout(),
    history: null,
    isHistoryLoading: false,
    muscles: [],
    equipmentLabel: null,
    isOwner: false,
    isLoading: false,
    error: null,
    onClose: jest.fn(),
    onEdit: jest.fn(),
    onStartWorkout: jest.fn(),
    onExercisePress: jest.fn(),
    ...overrides,
  };
  return { props, ...renderWithTheme(<WorkoutDetailPresenter {...props} />) };
}

describe("WorkoutDetailPresenter", () => {
  it("renders loading state when isLoading and no workout", () => {
    const { getByTestId } = renderDetail({ workout: null, isLoading: true });
    expect(getByTestId("workout-detail-loading")).toBeTruthy();
  });

  it("renders error state with message when error and no workout", () => {
    const { getByTestId, getByText } = renderDetail({
      workout: null,
      error: { kind: "api", code: "not_found", message: "It broke somehow" },
    });
    expect(getByTestId("workout-detail-error")).toBeTruthy();
    expect(getByText("It broke somehow")).toBeTruthy();
  });

  it("renders the hero: equipment eyebrow, stats, and muscle pills", () => {
    const { getByText } = renderDetail({
      workout: buildWorkout({
        estimatedDurationMinutes: 45,
        exercises: [
          buildExercise({ id: "we-1", targetSets: 3 }),
          buildExercise({ id: "we-2", exerciseId: "ex-2", targetSets: 4 }),
        ],
      }),
      muscles: ["Chest", "Shoulders"],
      equipmentLabel: "Machine",
    });
    expect(getByText("MACHINE · WORKOUT")).toBeTruthy();
    // DURATION 45, EXERCISES 2, TOTAL SETS 7 (3 + 4).
    expect(getByText("45")).toBeTruthy();
    expect(getByText("7")).toBeTruthy();
    expect(getByText("Chest")).toBeTruthy();
    expect(getByText("Shoulders")).toBeTruthy();
  });

  it("renders eyebrow as just WORKOUT when no equipment resolves", () => {
    const { getByText, queryByText } = renderDetail({ equipmentLabel: null });
    expect(getByText("WORKOUT")).toBeTruthy();
    expect(queryByText(/·/)).toBeNull();
  });

  it("hides description block when workout.description is null", () => {
    const { queryByText } = renderDetail({
      workout: buildWorkout({ description: null }),
    });
    expect(queryByText("Heavy chest session")).toBeNull();
  });

  it("renders the history block when the workout has been completed", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    const history: WorkoutHistory = {
      completedCount: 12,
      lastCompletedAt: threeDaysAgo,
      avgDurationSeconds: 2640, // 44m
      lastSession: {
        completedAt: "2026-03-21T10:00:00Z",
        totalVolumeKg: 6240,
        durationSeconds: 2820, // 47m
      },
    };
    const { getByTestId, getByText, queryByTestId } = renderDetail({ history });
    expect(getByTestId("workout-detail-history")).toBeTruthy();
    expect(queryByTestId("workout-detail-history-empty")).toBeNull();
    expect(getByText("3d ago")).toBeTruthy();
    expect(getByText("12×")).toBeTruthy();
    expect(getByText("44m")).toBeTruthy();
    // Footer recap: Mar 21 · 6,240 kg · 47 min.
    expect(getByText(/6,240 kg/)).toBeTruthy();
    expect(getByText(/Mar 21/)).toBeTruthy();
  });

  it("converts the footer volume recap to lb when weightUnit is lb", () => {
    const history: WorkoutHistory = {
      completedCount: 12,
      lastCompletedAt: null,
      avgDurationSeconds: null,
      lastSession: {
        completedAt: "2026-03-21T10:00:00Z",
        totalVolumeKg: 6240,
        durationSeconds: null,
      },
    };
    const { getByText, queryByText } = renderDetail({
      history,
      weightUnit: "lb",
    });
    // 6240 kg -> 13,757 lb (see workoutDetailFormat.test.ts for the maths).
    expect(getByText(/13,757 lb/)).toBeTruthy();
    expect(queryByText(/6,240 kg/)).toBeNull();
  });

  it("renders history with '—' fallbacks + omits ' min' when durations are null", () => {
    const history: WorkoutHistory = {
      completedCount: 2,
      lastCompletedAt: null,
      avgDurationSeconds: null,
      lastSession: {
        completedAt: "2026-03-21T10:00:00Z",
        totalVolumeKg: 3000,
        durationSeconds: null,
      },
    };
    const { getByTestId, getByText } = renderDetail({ history });
    expect(getByTestId("workout-detail-history")).toBeTruthy();
    // LAST DONE + AVG TIME fall back to em-dashes; COMPLETED still shows.
    expect(getByText("2×")).toBeTruthy();
    expect(getByText(/3,000 kg/)).toBeTruthy();
    // Footer still renders (with the last-session date) sans a duration segment.
    expect(getByText(/Mar 21/)).toBeTruthy();
  });

  it("shows 'Not done yet' when history is empty and not loading", () => {
    const { getByTestId, queryByTestId } = renderDetail({
      history: {
        completedCount: 0,
        lastCompletedAt: null,
        avgDurationSeconds: null,
        lastSession: null,
      },
    });
    expect(getByTestId("workout-detail-history-empty")).toBeTruthy();
    expect(queryByTestId("workout-detail-history")).toBeNull();
  });

  it("renders nothing for history while it is loading (no flash)", () => {
    const { queryByTestId } = renderDetail({
      history: null,
      isHistoryLoading: true,
    });
    expect(queryByTestId("workout-detail-history")).toBeNull();
    expect(queryByTestId("workout-detail-history-empty")).toBeNull();
  });

  it("groups supersets with a centred letter pill + member tags", () => {
    const workout = buildWorkout({
      exercises: [
        buildExercise({ id: "we-1", exerciseId: "ex-1", supersetGroup: null }),
        buildExercise({
          id: "we-2",
          exerciseId: "ex-2",
          sortOrder: 2,
          supersetGroup: 7,
          exercise: {
            id: "ex-2",
            name: "Lateral Raise",
            category: "strength",
            difficultyLevel: "beginner",
            videoUrl: null,
            thumbnailUrl: null,
          },
        }),
        buildExercise({
          id: "we-3",
          exerciseId: "ex-3",
          sortOrder: 3,
          supersetGroup: 7,
          exercise: {
            id: "ex-3",
            name: "Face Pull",
            category: "strength",
            difficultyLevel: "beginner",
            videoUrl: null,
            thumbnailUrl: null,
          },
        }),
      ],
    });
    const onExercisePress = jest.fn();
    const { getByText, getByTestId } = renderDetail({
      workout,
      onExercisePress,
    });
    expect(getByTestId("workout-detail-superset-A")).toBeTruthy();
    expect(getByText("SUPERSET A")).toBeTruthy();
    expect(getByText("A1")).toBeTruthy();
    expect(getByText("A2")).toBeTruthy();
    expect(getByText("Lateral Raise")).toBeTruthy();
    // Superset member rows are tappable → exercise detail.
    fireEvent.press(getByTestId("workout-detail-exercise-ex-2"));
    expect(onExercisePress).toHaveBeenCalledWith("ex-2");
    // Rest-derived footer copy from the lead's restSeconds (default 60).
    expect(getByText(/back-to-back · 60s rest after/)).toBeTruthy();
  });

  it("renders a lone superset member as a plain single (no connector)", () => {
    const workout = buildWorkout({
      exercises: [
        buildExercise({
          id: "we-1",
          exerciseId: "ex-1",
          supersetGroup: 3,
          restSeconds: null,
        }),
      ],
    });
    const { queryByText, getByTestId } = renderDetail({ workout });
    // No superset connector — it collapsed to a numbered single row.
    expect(queryByText(/SUPERSET/)).toBeNull();
    expect(getByTestId("workout-detail-exercise-ex-1")).toBeTruthy();
  });

  it("renders single-value reps when min === max", () => {
    const workout = buildWorkout({
      exercises: [
        buildExercise({ targetSets: 3, targetRepsMin: 10, targetRepsMax: 10 }),
      ],
    });
    const { getByText } = renderDetail({ workout });
    expect(getByText("3 sets × 10 reps")).toBeTruthy();
  });

  it("shows the owner edit button + note only for the owner", () => {
    const onEdit = jest.fn();
    const { getByTestId, queryByTestId, rerender, props } = renderDetail({
      isOwner: true,
      onEdit,
    });
    fireEvent.press(getByTestId("workout-detail-edit"));
    expect(onEdit).toHaveBeenCalledTimes(1);

    rerender(<WorkoutDetailPresenter {...props} isOwner={false} />);
    expect(queryByTestId("workout-detail-edit")).toBeNull();
  });

  it("invokes callbacks on back / start / exercise tap", () => {
    const onClose = jest.fn();
    const onStartWorkout = jest.fn();
    const onExercisePress = jest.fn();
    const { getByTestId } = renderDetail({
      onClose,
      onStartWorkout,
      onExercisePress,
    });
    fireEvent.press(getByTestId("workout-detail-back"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId("workout-detail-start"));
    expect(onStartWorkout).toHaveBeenCalledWith("w-1");
    fireEvent.press(getByTestId("workout-detail-exercise-ex-1"));
    expect(onExercisePress).toHaveBeenCalledWith("ex-1");
  });
});
