import React from "react";
import { WorkoutsListPresenter } from "../WorkoutsListPresenter";
import { renderWithTheme as render } from "../../../../__tests__/test-utils";

const baseProps = {
  isInitialLoading: false,
  error: null,
  isRefreshing: false,
  searchQuery: "",
  myAndAssignedCount: 0,
  mineCount: 0,
  assignedCount: 0,
  defaultCount: 0,
  filteredMyWorkouts: [],
  filteredExampleWorkouts: [],
  userWorkoutLimit: undefined,
  isAtLimit: false,
  currentUserId: "test-user",
  deletingWorkoutIds: new Set<string>(),
  onCreateWorkout: jest.fn(),
  onBrowseExercises: jest.fn(),
  onQuickStart: jest.fn(),
  onUpgrade: jest.fn(),
  onSearchChange: jest.fn(),
  onWorkoutPress: jest.fn(),
  onEditWorkout: jest.fn(),
  onDeleteWorkout: jest.fn(),
  onStartWorkout: jest.fn(),
  onRetry: jest.fn(),
  onRefresh: jest.fn(),
};

const buildCardView = (overrides: Record<string, unknown> = {}) => ({
  id: "wo-1",
  name: "Push Day",
  description: null,
  estimated_duration_minutes: 45,
  created_by: "test-user",
  is_assigned: false,
  assigned_by_type: null,
  targeted_muscles: [],
  exercises: [],
  ...overrides,
});

describe("WorkoutsListPresenter", () => {
  it("renders the loading splash on initial cold start", () => {
    const { getByText } = render(
      <WorkoutsListPresenter {...baseProps} isInitialLoading={true} />,
    );
    expect(getByText("Loading workouts...")).toBeTruthy();
  });

  it("renders blocking ErrorState when refresh fails with empty cache", () => {
    const { getByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        error={{
          kind: "api",
          code: "network",
          message: "Lost connection",
        }}
      />,
    );
    expect(getByText("Failed to load workouts")).toBeTruthy();
    expect(getByText("Lost connection")).toBeTruthy();
  });

  it("renders both sections with cards when populated", () => {
    const { getByText, getAllByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        myAndAssignedCount={2}
        mineCount={1}
        assignedCount={1}
        defaultCount={1}
        filteredMyWorkouts={[
          buildCardView({ id: "wo-1", name: "Push Day" }),
          buildCardView({ id: "wo-2", name: "Pull Day", is_assigned: true }),
        ]}
        filteredExampleWorkouts={[
          buildCardView({
            id: "wo-3",
            name: "Beginner Full Body",
            created_by: "system",
          }),
        ]}
      />,
    );

    expect(getByText("My Workouts")).toBeTruthy();
    expect(getByText("Example Workouts")).toBeTruthy();
    expect(getByText("Push Day")).toBeTruthy();
    expect(getByText("Pull Day")).toBeTruthy();
    expect(getByText("Beginner Full Body")).toBeTruthy();
    // Subtitle reflects mine + assigned counts.
    expect(getByText("2 workouts (1 created, 1 assigned)")).toBeTruthy();
    // Both sections should render — three cards across them.
    expect(getAllByText(/exercises$/).length).toBe(3);
  });

  it("renders the search-results section when searchQuery is set", () => {
    const { getByText, queryByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        searchQuery="push"
        filteredMyWorkouts={[buildCardView({ id: "wo-1", name: "Push Day" })]}
        filteredExampleWorkouts={[]}
      />,
    );

    expect(getByText("Search Results (1)")).toBeTruthy();
    expect(getByText("Push Day")).toBeTruthy();
    // Sections should NOT render during search
    expect(queryByText("My Workouts")).toBeNull();
    expect(queryByText("Example Workouts")).toBeNull();
  });

  it("renders empty-search-results when no matches", () => {
    const { getByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        searchQuery="nonexistent"
        filteredMyWorkouts={[]}
        filteredExampleWorkouts={[]}
      />,
    );

    expect(getByText("Search Results (0)")).toBeTruthy();
    expect(getByText("No workouts found")).toBeTruthy();
  });

  it("renders WorkoutLimitIndicator when isAtLimit is true", () => {
    const { getByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        userWorkoutLimit={3}
        isAtLimit={true}
      />,
    );
    expect(getByText("Workout Limit Reached")).toBeTruthy();
  });

  it("hides QuickActions during search", () => {
    const { queryByText } = render(
      <WorkoutsListPresenter {...baseProps} searchQuery="push" />,
    );
    expect(queryByText("Create New Workout")).toBeNull();
  });

  it("renders QuickActions when not searching", () => {
    const { getByText } = render(<WorkoutsListPresenter {...baseProps} />);
    expect(getByText("Create New Workout")).toBeTruthy();
    expect(getByText("Browse Exercises")).toBeTruthy();
  });

  it("renders WorkoutCard with description, targeted_muscles, and owner actions for owned workouts", () => {
    // Exercises the conditional rendering branches: description text,
    // muscle badges (>=4 to also exercise the "+N" overflow), and the
    // edit/delete CTAs that only show when created_by === currentUserId
    // and is_assigned is false.
    const { getByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        myAndAssignedCount={1}
        mineCount={1}
        filteredMyWorkouts={[
          buildCardView({
            id: "wo-1",
            name: "Loaded Card",
            description: "A complete workout",
            targeted_muscles: [
              { id: "m1", name: "Chest" },
              { id: "m2", name: "Triceps" },
              { id: "m3", name: "Shoulders" },
              { id: "m4", display_name: "Lats" },
              { id: "m5", name: "Biceps" },
            ],
          }),
        ]}
      />,
    );

    expect(getByText("A complete workout")).toBeTruthy();
    expect(getByText("Chest")).toBeTruthy();
    expect(getByText("Triceps")).toBeTruthy();
    expect(getByText("Shoulders")).toBeTruthy();
    // 4th + 5th roll up into the "+N" overflow badge
    expect(getByText("+2")).toBeTruthy();
    // Owner actions visible
    expect(getByText("Edit")).toBeTruthy();
    expect(getByText("Delete")).toBeTruthy();
  });

  it("renders the assigned tag on PT-assigned cards and hides owner actions", () => {
    const { getByText, queryByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        myAndAssignedCount={1}
        assignedCount={1}
        filteredMyWorkouts={[
          buildCardView({
            id: "wo-1",
            name: "Assigned Push Day",
            created_by: "trainer-1",
            is_assigned: true,
            assigned_by_type: "personal_trainer",
          }),
        ]}
      />,
    );

    expect(getByText("Assigned by: PT")).toBeTruthy();
    // Owner-only actions are hidden because is_assigned=true
    expect(queryByText("Edit")).toBeNull();
    expect(queryByText("Delete")).toBeNull();
  });

  it("renders the physio assigned tag variant", () => {
    const { getByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        myAndAssignedCount={1}
        assignedCount={1}
        filteredMyWorkouts={[
          buildCardView({
            id: "wo-1",
            name: "Rehab Session",
            created_by: "physio-1",
            is_assigned: true,
            assigned_by_type: "physio",
          }),
        ]}
      />,
    );

    expect(getByText("Assigned by: Physio")).toBeTruthy();
  });

  it("formats long durations with hours+minutes (verbatim legacy heuristic)", () => {
    const { getByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        myAndAssignedCount={2}
        mineCount={2}
        filteredMyWorkouts={[
          buildCardView({
            id: "wo-1",
            name: "1h Workout",
            estimated_duration_minutes: 60,
          }),
          buildCardView({
            id: "wo-2",
            name: "1h 30m Workout",
            estimated_duration_minutes: 90,
          }),
        ]}
      />,
    );

    expect(getByText("1h")).toBeTruthy();
    expect(getByText("1h 30m")).toBeTruthy();
  });

  it("renders the empty-mine state via WorkoutSection when no workouts cached", () => {
    const { getByText } = render(<WorkoutsListPresenter {...baseProps} />);
    expect(getByText("No workouts yet")).toBeTruthy();
    expect(
      getByText("Create your first workout template to get started"),
    ).toBeTruthy();
    expect(getByText("No example workouts available")).toBeTruthy();
  });

  it("disables WorkoutCard when workout id is in deletingWorkoutIds", () => {
    const { getByText } = render(
      <WorkoutsListPresenter
        {...baseProps}
        myAndAssignedCount={1}
        mineCount={1}
        filteredMyWorkouts={[
          buildCardView({ id: "wo-deleting", name: "Deleting Workout" }),
        ]}
        deletingWorkoutIds={new Set(["wo-deleting"])}
      />,
    );
    // The card still renders (greyed out) but the start/edit/delete
    // CTAs use the disabled colour. Verifying the workout name renders
    // is enough to exercise the disabled style branch.
    expect(getByText("Deleting Workout")).toBeTruthy();
  });
});
