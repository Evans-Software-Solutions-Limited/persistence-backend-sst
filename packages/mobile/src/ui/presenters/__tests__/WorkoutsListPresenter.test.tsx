import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { RefreshControl } from "react-native";

import type { Workout } from "@/domain/models/workout";
import type { WorkoutSplit } from "@/domain/services/workoutSplit";
import { WorkoutsListPresenter } from "../WorkoutsListPresenter";
import { renderWithTheme as render } from "../../../../__tests__/test-utils";

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: "wo-1",
  name: "Push Day",
  description: null,
  createdBy: "test-user",
  visibility: "private",
  estimatedDurationMinutes: 45,
  exercises: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const baseProps = {
  isInitialLoading: false,
  error: null,
  isRefreshing: false,
  saved: [] as Workout[],
  templates: [] as Workout[],
  splits: new Map<string, WorkoutSplit>(),
  userWorkoutLimit: undefined,
  isAtLimit: false,
  currentUserId: "test-user",
  onCreate: jest.fn(),
  onUpgrade: jest.fn(),
  onOpen: jest.fn(),
  onStart: jest.fn(),
  onLongPress: jest.fn(),
  onRetry: jest.fn(),
  onRefresh: jest.fn(),
};

describe("WorkoutsListPresenter", () => {
  it("renders the loading splash on initial cold start", () => {
    const { getByText } = render(
      <WorkoutsListPresenter {...baseProps} isInitialLoading />,
    );
    expect(getByText("Loading workouts...")).toBeTruthy();
  });

  it("renders a blocking ErrorState when refresh fails with empty cache", () => {
    const { getByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        error={{ kind: "api", code: "network", message: "Lost connection" }}
      />,
    );
    expect(getByText("Failed to load workouts")).toBeTruthy();
    expect(getByText("Lost connection")).toBeTruthy();
  });

  it("renders the cached list (not the error wall) when an error arrives with cached data", () => {
    const { getByText, queryByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        error={{ kind: "api", code: "network", message: "Lost connection" }}
        saved={[buildWorkout({ id: "wo-1", name: "Cached Push" })]}
      />,
    );
    expect(getByText("Cached Push")).toBeTruthy();
    expect(queryByText("Failed to load workouts")).toBeNull();
  });

  it("renders the empty My Workouts state with no Create CTA inside it", () => {
    const { getByText, queryByText, getByTestId } = render(
      <WorkoutsListPresenter {...baseProps} />,
    );
    expect(getByText("MY WORKOUTS · 0 SAVED")).toBeTruthy();
    expect(getByText("No workouts yet")).toBeTruthy();
    // The only Create path is the top CTA — the empty state has no button.
    expect(getByTestId("create-workout-cta")).toBeTruthy();
    // No Browse Exercises button (prototype has none) + no Templates section.
    expect(queryByText("Browse Exercises")).toBeNull();
    expect(queryByText(/^TEMPLATES/)).toBeNull();
  });

  it("renders the two eyebrow sections when populated", () => {
    const { getByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        saved={[
          buildWorkout({ id: "wo-1", name: "Push Day" }),
          buildWorkout({ id: "wo-2", name: "Coach Pull", createdBy: "coach" }),
        ]}
        templates={[
          buildWorkout({ id: "wo-3", name: "PPL Legs", createdBy: "system" }),
        ]}
      />,
    );
    expect(getByText("MY WORKOUTS · 2 SAVED")).toBeTruthy();
    expect(getByText("TEMPLATES · 1")).toBeTruthy();
    expect(getByText("Push Day")).toBeTruthy();
    expect(getByText("Coach Pull")).toBeTruthy();
    expect(getByText("PPL Legs")).toBeTruthy();
  });

  it("renders the split badge for a workout when a split is supplied", () => {
    const { getByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        saved={[buildWorkout({ id: "wo-7", name: "Upper Body" })]}
        splits={new Map<string, WorkoutSplit>([["wo-7", "push"]])}
      />,
    );
    expect(getByText("PUSH")).toBeTruthy();
  });

  it("renders the WorkoutLimitIndicator when isAtLimit is true", () => {
    const { getByText } = render(
      <WorkoutsListPresenter {...baseProps} userWorkoutLimit={3} isAtLimit />,
    );
    expect(getByText("Workout Limit Reached")).toBeTruthy();
  });

  it("fires onCreate from the Create Workout CTA", () => {
    const onCreate = jest.fn();
    const { getByTestId } = render(
      <WorkoutsListPresenter {...baseProps} onCreate={onCreate} />,
    );
    fireEvent.press(getByTestId("create-workout-cta"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("fires onUpgrade from the limit indicator", () => {
    const onUpgrade = jest.fn();
    const { getByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        userWorkoutLimit={3}
        isAtLimit
        onUpgrade={onUpgrade}
      />,
    );
    fireEvent.press(getByText("Upgrade Now"));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it("opens a saved workout on row press and starts it from the Play button", () => {
    const onOpen = jest.fn();
    const onStart = jest.fn();
    const { getByTestId, getByLabelText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        saved={[buildWorkout({ id: "wo-7", name: "Upper Body" })]}
        onOpen={onOpen}
        onStart={onStart}
      />,
    );
    fireEvent.press(getByTestId("workout-row-wo-7"));
    expect(onOpen).toHaveBeenCalledWith("wo-7");
    fireEvent.press(getByLabelText("Start Upper Body"));
    expect(onStart).toHaveBeenCalledWith("wo-7");
  });

  it("renders template rows with a chevron (no Play) and opens them on press", () => {
    const onOpen = jest.fn();
    const { getByTestId, queryByLabelText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        templates={[
          buildWorkout({ id: "tpl-1", name: "PPL Push", createdBy: "system" }),
        ]}
        onOpen={onOpen}
      />,
    );
    // Templates have no Play button.
    expect(queryByLabelText("Start PPL Push")).toBeNull();
    fireEvent.press(getByTestId("workout-row-tpl-1"));
    expect(onOpen).toHaveBeenCalledWith("tpl-1");
  });

  it("wires long-press only on saved rows the current user owns", () => {
    const onLongPress = jest.fn();
    const { getByTestId } = render(
      <WorkoutsListPresenter
        {...baseProps}
        currentUserId="test-user"
        saved={[buildWorkout({ id: "wo-mine", createdBy: "test-user" })]}
        onLongPress={onLongPress}
      />,
    );
    fireEvent(getByTestId("workout-row-wo-mine"), "longPress");
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("invokes onRefresh from the RefreshControl", () => {
    const onRefresh = jest.fn();
    const { UNSAFE_getByType } = render(
      <WorkoutsListPresenter {...baseProps} onRefresh={onRefresh} />,
    );
    fireEvent(UNSAFE_getByType(RefreshControl), "refresh");
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
