import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import type { Workout } from "@/domain/models/workout";
import {
  CoachWorkoutLibraryPresenter,
  type CoachWorkoutLibraryPresenterProps,
} from "../CoachWorkoutLibraryPresenter";

/**
 * CoachWorkoutLibraryPresenter tests.
 *
 * Spec: specs/24-coach-authoring/design.md § B.3, § B.6
 *       specs/24-coach-authoring/requirements.md STORY-001 (AC 1.3)
 *
 * The non-embedded (standalone route) path is already exercised indirectly
 * via CoachWorkoutLibraryContainer.test.tsx; this suite is the presenter's
 * own unit coverage plus the `embedded` variance the hub relies on.
 */

function buildWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: overrides.id ?? "w-1",
    name: overrides.name ?? "Push Day",
    description: null,
    createdBy: "user-1",
    visibility: "private",
    estimatedDurationMinutes: 45,
    showInOwnerLibrary: overrides.showInOwnerLibrary ?? true,
    exercises: overrides.exercises ?? [],
    createdAt: "2026-04-28T00:00:00Z",
    updatedAt: "2026-04-28T00:00:00Z",
    ...overrides,
  };
}

function baseProps(
  overrides: Partial<CoachWorkoutLibraryPresenterProps> = {},
): CoachWorkoutLibraryPresenterProps {
  return {
    workouts: [],
    isLoading: false,
    isRefreshing: false,
    error: null,
    onBack: jest.fn(),
    onCreate: jest.fn(),
    onOpen: jest.fn(),
    onRefresh: jest.fn(),
    ...overrides,
  };
}

describe("CoachWorkoutLibraryPresenter", () => {
  it("renders the back-button header + title by default (standalone route)", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <CoachWorkoutLibraryPresenter {...baseProps()} />,
    );
    expect(getByText("Workout library")).toBeTruthy();
    expect(getByTestId("coach-library-back")).toBeTruthy();
  });

  it("fires onBack when the back button is pressed (standalone route)", () => {
    const onBack = jest.fn();
    const { getByTestId } = renderWithTheme(
      <CoachWorkoutLibraryPresenter {...baseProps({ onBack })} />,
    );
    fireEvent.press(getByTestId("coach-library-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("embedded: hides the back button + title + own create CTA (hub owns those)", () => {
    const { queryByTestId, queryByText, getByTestId } = renderWithTheme(
      <CoachWorkoutLibraryPresenter {...baseProps({ embedded: true })} />,
    );
    expect(queryByTestId("coach-library-back")).toBeNull();
    expect(queryByText("Workout library")).toBeNull();
    // The hub's top-right contextual action owns "Create workout" when
    // embedded — the body's own create CTA is suppressed to avoid a duplicate.
    expect(queryByTestId("coach-library-create")).toBeNull();
    // The body content still renders (e.g. the empty state).
    expect(getByTestId("coach-library-empty")).toBeTruthy();
  });

  it("shows the loading state only when there are no cached workouts", () => {
    const { getByTestId } = renderWithTheme(
      <CoachWorkoutLibraryPresenter
        {...baseProps({ isLoading: true, workouts: [] })}
      />,
    );
    expect(getByTestId("coach-library-loading")).toBeTruthy();
  });

  it("does not show the loading state when cached workouts are present", () => {
    const { queryByTestId } = renderWithTheme(
      <CoachWorkoutLibraryPresenter
        {...baseProps({ isLoading: true, workouts: [buildWorkout()] })}
      />,
    );
    expect(queryByTestId("coach-library-loading")).toBeNull();
  });

  it("shows the error state (with retry) only when there are no cached workouts", () => {
    const onRefresh = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <CoachWorkoutLibraryPresenter
        {...baseProps({ error: "offline", workouts: [], onRefresh })}
      />,
    );
    expect(getByTestId("coach-library-error")).toBeTruthy();
    expect(getByText("offline")).toBeTruthy();
    fireEvent.press(getByTestId("coach-library-retry"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps rendering cached workouts when an error arrives with data present", () => {
    const { queryByTestId, getByText } = renderWithTheme(
      <CoachWorkoutLibraryPresenter
        {...baseProps({ error: "offline", workouts: [buildWorkout()] })}
      />,
    );
    expect(queryByTestId("coach-library-error")).toBeNull();
    expect(getByText("Push Day")).toBeTruthy();
  });

  it("shows the empty state when there are no workouts", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <CoachWorkoutLibraryPresenter {...baseProps({ workouts: [] })} />,
    );
    expect(getByTestId("coach-library-empty")).toBeTruthy();
    expect(getByText("No workouts yet")).toBeTruthy();
  });

  it("fires onCreate from the create CTA", () => {
    const onCreate = jest.fn();
    const { getByTestId } = renderWithTheme(
      <CoachWorkoutLibraryPresenter {...baseProps({ onCreate })} />,
    );
    fireEvent.press(getByTestId("coach-library-create"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("lists workouts, pluralises the exercise count, and marks hidden-from-owner rows", () => {
    const onOpen = jest.fn();
    const workouts = [
      buildWorkout({
        id: "w-1",
        name: "Solo Exercise",
        exercises: [{ exerciseId: "e-1" }] as never,
        showInOwnerLibrary: true,
      }),
      buildWorkout({
        id: "w-2",
        name: "Client Only",
        exercises: [] as never,
        showInOwnerLibrary: false,
      }),
    ];
    const { getByTestId, getByText } = renderWithTheme(
      <CoachWorkoutLibraryPresenter {...baseProps({ workouts, onOpen })} />,
    );
    expect(getByText("1 exercise")).toBeTruthy();
    expect(getByText(/0 exercises · Hidden from my workouts/)).toBeTruthy();
    fireEvent.press(getByTestId("coach-library-row-w-1"));
    expect(onOpen).toHaveBeenCalledWith("w-1");
  });

  it("shows the refreshing indicator without hiding the list", () => {
    const { getByText } = renderWithTheme(
      <CoachWorkoutLibraryPresenter
        {...baseProps({ workouts: [buildWorkout()], isRefreshing: true })}
      />,
    );
    expect(getByText("Push Day")).toBeTruthy();
  });
});
