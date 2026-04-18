import { fireEvent } from "@testing-library/react-native";
import type { Exercise } from "@/domain/models/exercise";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ExerciseListPresenter } from "../ExerciseListPresenter";

jest.setTimeout(15_000);

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "ex-1",
    name: "Barbell Back Squat",
    description: null,
    instructions: null,
    category: "strength",
    difficulty: "intermediate",
    primaryMuscleGroups: ["quadriceps"],
    secondaryMuscleGroups: [],
    equipment: ["barbell"],
    isCustom: false,
    createdBy: null,
    ...overrides,
  };
}

function makeProps(
  overrides: Partial<Parameters<typeof ExerciseListPresenter>[0]> = {},
): Parameters<typeof ExerciseListPresenter>[0] {
  return {
    exercises: [],
    searchInput: "",
    muscleGroups: [],
    equipment: [],
    category: null,
    difficulty: null,
    lastSyncedAt: null,
    isStale: false,
    isRefreshing: false,
    showSkeleton: false,
    loadError: null,
    onSearchChange: jest.fn(),
    onToggleMuscleGroup: jest.fn(),
    onToggleEquipment: jest.fn(),
    onSelectCategory: jest.fn(),
    onSelectDifficulty: jest.fn(),
    onClearFilters: jest.fn(),
    onRefresh: jest.fn(),
    onSelectExercise: jest.fn(),
    onCreateExercise: jest.fn(),
    ...overrides,
  };
}

describe("ExerciseListPresenter", () => {
  it("renders the title and the exercise count", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({
          exercises: [makeExercise(), makeExercise({ id: "ex-2" })],
        })}
      />,
    );
    expect(getByTestId("exercise-list-title")).toBeTruthy();
    expect(getByText("2 exercises")).toBeTruthy();
  });

  it("uses singular label when exactly one exercise is listed", () => {
    const { getByText } = renderWithTheme(
      <ExerciseListPresenter {...makeProps({ exercises: [makeExercise()] })} />,
    );
    expect(getByText("1 exercise")).toBeTruthy();
  });

  it("renders each exercise as a card", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({
          exercises: [
            makeExercise({ id: "a", name: "A" }),
            makeExercise({ id: "b", name: "B" }),
          ],
        })}
      />,
    );
    expect(getByTestId("exercise-card-a")).toBeTruthy();
    expect(getByTestId("exercise-card-b")).toBeTruthy();
  });

  it("fires onSearchChange when the search input changes", () => {
    const onSearchChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseListPresenter {...makeProps({ onSearchChange })} />,
    );
    fireEvent.changeText(getByTestId("exercise-search-input"), "squat");
    expect(onSearchChange).toHaveBeenCalledWith("squat");
  });

  it("fires onCreateExercise from the header New button", () => {
    const onCreateExercise = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseListPresenter {...makeProps({ onCreateExercise })} />,
    );
    fireEvent.press(getByTestId("create-exercise-button"));
    expect(onCreateExercise).toHaveBeenCalledTimes(1);
  });

  it("forwards card press to onSelectExercise with the id", () => {
    const onSelectExercise = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({
          exercises: [makeExercise({ id: "xyz" })],
          onSelectExercise,
        })}
      />,
    );
    fireEvent.press(getByTestId("exercise-card-xyz"));
    expect(onSelectExercise).toHaveBeenCalledWith("xyz");
  });

  it("shows skeleton placeholders while the initial refresh is in-flight", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({ showSkeleton: true, isRefreshing: true })}
      />,
    );
    expect(getByTestId("exercise-list-skeleton")).toBeTruthy();
    expect(queryByTestId("exercise-list-empty")).toBeNull();
  });

  it("shows error state with retry when loadError is set and no cache", () => {
    const onRefresh = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({ loadError: "Network down", onRefresh })}
      />,
    );
    expect(getByTestId("exercise-list-error")).toBeTruthy();
    fireEvent.press(getByText("Retry"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the filtered empty state when the user has active filters or a search", () => {
    const onClearFilters = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({
          searchInput: "unmatched",
          onClearFilters,
        })}
      />,
    );
    expect(getByTestId("exercise-list-empty-filtered")).toBeTruthy();
    fireEvent.press(getByText("Clear filters"));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("shows the default empty state with a create action when there are no filters", () => {
    const onCreateExercise = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <ExerciseListPresenter {...makeProps({ onCreateExercise })} />,
    );
    expect(getByTestId("exercise-list-empty")).toBeTruthy();
    fireEvent.press(getByText("Create exercise"));
    // header button and empty-state button are both wired to the same handler.
    expect(onCreateExercise).toHaveBeenCalled();
  });

  it("renders the stale banner when isStale is true and exercises exist", () => {
    const now = () => Date.parse("2026-04-18T12:00:00Z");
    const { getByTestId } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({
          exercises: [makeExercise()],
          isStale: true,
          lastSyncedAt: "2026-04-17T12:00:00Z",
          now,
        })}
      />,
    );
    expect(getByTestId("exercise-list-stale-banner")).toBeTruthy();
  });

  it("hides the stale banner when the cache is not stale", () => {
    const { queryByTestId } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({
          exercises: [makeExercise()],
          isStale: false,
          lastSyncedAt: new Date().toISOString(),
        })}
      />,
    );
    expect(queryByTestId("exercise-list-stale-banner")).toBeNull();
  });

  it("formats last-synced ages across the minute/hour/day thresholds", () => {
    const anchor = Date.parse("2026-04-18T12:00:00Z");
    const now = () => anchor;

    const cases: { syncedAt: string; expected: RegExp }[] = [
      {
        syncedAt: new Date(anchor - 30_000).toISOString(),
        expected: /Updated just now/,
      },
      {
        syncedAt: new Date(anchor - 10 * 60_000).toISOString(),
        expected: /Updated 10m ago/,
      },
      {
        syncedAt: new Date(anchor - 3 * 60 * 60_000).toISOString(),
        expected: /Updated 3h ago/,
      },
      {
        syncedAt: new Date(anchor - 5 * 24 * 60 * 60_000).toISOString(),
        expected: /Updated 5d ago/,
      },
    ];

    for (const { syncedAt, expected } of cases) {
      const { getByText, unmount } = renderWithTheme(
        <ExerciseListPresenter
          {...makeProps({
            exercises: [makeExercise()],
            isStale: true,
            lastSyncedAt: syncedAt,
            now,
          })}
        />,
      );
      expect(getByText(expected)).toBeTruthy();
      unmount();
    }
  });

  it("falls back to 'Not synced yet' when lastSyncedAt is null", () => {
    const { getByText } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({
          exercises: [makeExercise()],
          isStale: true,
          lastSyncedAt: null,
        })}
      />,
    );
    expect(getByText(/Not synced yet/)).toBeTruthy();
  });

  it("falls back to 'Not synced yet' when lastSyncedAt is unparseable", () => {
    const { getByText } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({
          exercises: [makeExercise()],
          isStale: true,
          lastSyncedAt: "not-a-date",
        })}
      />,
    );
    expect(getByText(/Not synced yet/)).toBeTruthy();
  });
});
