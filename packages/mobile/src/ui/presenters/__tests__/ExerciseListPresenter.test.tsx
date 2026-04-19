import { fireEvent } from "@testing-library/react-native";
import type { Exercise } from "@/domain/models/exercise";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ExerciseListPresenter } from "../ExerciseListPresenter";

jest.setTimeout(15_000);

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  const Ionicons = ({ name }: { name: string }) => (
    <Text testID={`icon-${name}`}>{name}</Text>
  );
  return { Ionicons };
});

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
    selectedQuickFilters: ["all"],
    hasAdvancedFilters: false,
    hasAnyFilter: false,
    lastSyncedAt: null,
    isStale: false,
    isRefreshing: false,
    showSkeleton: false,
    loadError: null,
    onSearchChange: jest.fn(),
    onToggleQuickFilter: jest.fn(),
    onOpenFilterModal: jest.fn(),
    onClearFilters: jest.fn(),
    onRefresh: jest.fn(),
    onSelectExercise: jest.fn(),
    onCreateExercise: jest.fn(),
    ...overrides,
  };
}

describe("ExerciseListPresenter", () => {
  it("renders the 'Exercises' title", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ExerciseListPresenter {...makeProps()} />,
    );
    expect(getByTestId("exercise-list-title")).toBeTruthy();
    expect(getByText("Exercises")).toBeTruthy();
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

  it("clears search text when the close button is pressed", () => {
    const onSearchChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({ searchInput: "squat", onSearchChange })}
      />,
    );
    fireEvent.press(getByTestId("exercise-search-clear"));
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("does not render the clear-search button when search is empty", () => {
    const { queryByTestId } = renderWithTheme(
      <ExerciseListPresenter {...makeProps({ searchInput: "" })} />,
    );
    expect(queryByTestId("exercise-search-clear")).toBeNull();
  });

  it("fires onCreateExercise when the inline + button is pressed", () => {
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
    const { getByTestId } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({ showSkeleton: true, isRefreshing: true })}
      />,
    );
    expect(getByTestId("exercise-list-skeleton")).toBeTruthy();
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

  it("shows the filtered empty state when any filter is active", () => {
    const onClearFilters = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({ hasAnyFilter: true, onClearFilters })}
      />,
    );
    expect(getByTestId("exercise-list-empty-filtered")).toBeTruthy();
    fireEvent.press(getByText("Clear filters"));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("shows the default empty state when there are no filters", () => {
    const onCreateExercise = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <ExerciseListPresenter {...makeProps({ onCreateExercise })} />,
    );
    expect(getByTestId("exercise-list-empty")).toBeTruthy();
    fireEvent.press(getByText("Create exercise"));
    expect(onCreateExercise).toHaveBeenCalled();
  });

  it("renders the stale banner and 'Pull to refresh' caption when stale", () => {
    const now = () => Date.parse("2026-04-18T12:00:00Z");
    const { getByTestId, getByText } = renderWithTheme(
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
    expect(getByText("Pull to refresh")).toBeTruthy();
  });

  it("keeps the stale banner visible when a filter narrows results to zero", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({
          exercises: [],
          hasAnyFilter: true,
          isStale: true,
          lastSyncedAt: "2026-04-17T12:00:00Z",
          now: () => Date.parse("2026-04-18T12:00:00Z"),
        })}
      />,
    );
    expect(getByTestId("exercise-list-stale-banner")).toBeTruthy();
    expect(getByTestId("exercise-list-empty-filtered")).toBeTruthy();
  });

  it("hides the stale banner when not stale", () => {
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

  it("hides the stale banner while the skeleton is showing", () => {
    const { queryByTestId } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({
          isStale: true,
          showSkeleton: true,
          isRefreshing: true,
        })}
      />,
    );
    expect(queryByTestId("exercise-list-stale-banner")).toBeNull();
  });

  it("hides the stale banner when a load error is being shown", () => {
    const { queryByTestId } = renderWithTheme(
      <ExerciseListPresenter
        {...makeProps({
          isStale: true,
          loadError: "Network down",
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

  it("forwards filter-modal open to onOpenFilterModal", () => {
    const onOpenFilterModal = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseListPresenter {...makeProps({ onOpenFilterModal })} />,
    );
    fireEvent.press(getByTestId("filter-modal-trigger"));
    expect(onOpenFilterModal).toHaveBeenCalledTimes(1);
  });
});
