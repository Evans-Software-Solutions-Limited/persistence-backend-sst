import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { HomePresenter, type HomePresenterProps } from "../HomePresenter";
import type { HomePayload } from "@/domain/models/progress";

function makeHome(overrides: Partial<HomePayload> = {}): HomePayload {
  return {
    rings: {
      move: { current: 7420, target: 10000, pct: 0.74, unit: "steps" },
      train: { current: 8400, target: 20000, pct: 0.42, unit: "kg" },
      fuel: "gated",
      todayPct: 58,
    },
    micro: { streak: 23, water: "6/8", strain: null, sleep: null },
    weeklyVolume: {
      days: [
        { date: "2026-06-08", volumeKg: 600, isToday: false, isRest: false },
        { date: "2026-06-09", volumeKg: 0, isToday: false, isRest: true },
        { date: "2026-06-10", volumeKg: 900, isToday: true, isRest: false },
      ],
      totalKg: 14820,
      deltaPct: 12,
      workouts: { completed: 4, target: 5 },
    },
    recentPRs: [
      {
        id: "pr1",
        userId: "u1",
        exerciseId: "e1",
        exerciseName: "Bench Press",
        recordType: "1rm",
        value: 85,
        achievedAt: "2026-06-08T00:00:00.000Z",
        sessionId: null,
        setId: null,
      },
    ],
    habits: [],
    todayWorkout: [],
    activeProgramme: null,
    todaysTraining: [],
    ...overrides,
  };
}

function render(overrides: Partial<HomePresenterProps> = {}) {
  const props: HomePresenterProps = {
    user: { name: "Alex", initials: "AL" },
    greeting: "Good morning",
    home: makeHome(),
    workouts: [
      { id: "w1", title: "Push Day", mins: 45, sub: "Chest + tris", chips: [] },
    ],
    workoutsLoading: false,
    habits: [
      {
        id: "g1",
        label: "Workout",
        tone: "primary",
        days: [true, true, false, true, false, true, false],
      },
    ],
    weekDates: [
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
    ],
    recentPRs: makeHome().recentPRs,
    showCoachPeek: false,
    isLoading: false,
    isRefreshing: false,
    onRefresh: jest.fn(),
    onOpenDrawer: jest.fn(),
    onOpenNotifications: jest.fn(),
    onOpenWorkout: jest.fn(),
    onOpenWorkoutsList: jest.fn(),
    onOpenTab: jest.fn(),
    onOpenWeighIn: jest.fn(),
    onOpenMealLog: jest.fn(),
    onLogWater: jest.fn(),
    onToggleHabitDay: jest.fn(),
    onOpenCoach: jest.fn(),
    ...overrides,
  };
  return { ...renderWithTheme(<HomePresenter {...props} />), props };
}

describe("HomePresenter (V2)", () => {
  it("renders the hero, habits, quick-log, volume + PR sections from cache", () => {
    const { getByTestId } = render();
    expect(getByTestId("home-scroll")).toBeTruthy();
    expect(getByTestId("home-hero")).toBeTruthy();
    expect(getByTestId("home-habits")).toBeTruthy();
    expect(getByTestId("home-quicklog")).toBeTruthy();
    expect(getByTestId("home-volume")).toBeTruthy();
    expect(getByTestId("home-prs")).toBeTruthy();
  });

  it("renders the time-of-day greeting + first name as the title", () => {
    const { getByText } = render({
      greeting: "Good morning",
      user: { name: "Alex", initials: "AL" },
    });
    expect(getByText(/Good morning/)).toBeTruthy();
    expect(getByText("Alex")).toBeTruthy(); // colored-name node
  });

  it("falls back to just the greeting when the name isn't loaded", () => {
    const { getByText, queryByText } = render({
      greeting: "Good evening",
      user: { name: null, initials: "?" },
    });
    expect(getByText("Good evening")).toBeTruthy();
    expect(queryByText(/,\s*$/)).toBeNull(); // no dangling "greeting, "
  });

  it("shows the blocking loader only when there is no cache", () => {
    const { getByTestId } = render({ home: null, isLoading: true });
    expect(getByTestId("home-loader")).toBeTruthy();
  });

  it("renders the error state when no cache + error", () => {
    const { getByTestId } = render({
      home: null,
      error: { kind: "api", code: "server", message: "boom" },
    });
    expect(getByTestId("home-error-state")).toBeTruthy();
  });

  it("gates the CoachQuickPeek behind showCoachPeek + coachPeek data", () => {
    const { queryByTestId } = render({ showCoachPeek: false });
    expect(queryByTestId("home-coach-peek")).toBeNull();
    const { getByTestId } = render({
      showCoachPeek: true,
      coachPeek: { clientCount: 8, needAttention: 3, newPRs: 1 },
    });
    expect(getByTestId("home-coach-peek")).toBeTruthy();
  });

  it("keeps the PR section but shows an empty state when there are no recent PRs", () => {
    const { getByTestId, queryByTestId } = render({ recentPRs: [] });
    expect(getByTestId("home-prs")).toBeTruthy();
    expect(getByTestId("home-prs-empty")).toBeTruthy();
    expect(queryByTestId("pr-carousel")).toBeNull();
  });

  it("renders the workouts carousel + fires onOpenWorkout on a card press", () => {
    const onOpenWorkout = jest.fn();
    const { getByTestId } = render({ onOpenWorkout });
    expect(getByTestId("home-workouts")).toBeTruthy();
    fireEvent.press(getByTestId("workout-carousel-card-0"));
    expect(onOpenWorkout).toHaveBeenCalledWith("w1");
  });

  it("shows the workouts empty state when the user has none", () => {
    const { getByTestId } = render({ workouts: [] });
    expect(getByTestId("workout-carousel-empty")).toBeTruthy();
  });

  it("workouts 'View all' fires onOpenWorkoutsList (pins the Workouts segment)", () => {
    const onOpenWorkoutsList = jest.fn();
    const { getByText } = render({ onOpenWorkoutsList });
    fireEvent.press(getByText("View all"));
    expect(onOpenWorkoutsList).toHaveBeenCalledTimes(1);
  });

  it("renders the header bell and fires onOpenNotifications on press", () => {
    const onOpenNotifications = jest.fn();
    const { getByTestId } = render({ onOpenNotifications });
    fireEvent.press(getByTestId("home-bell"));
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);
  });

  // -- 19-programs F2: "Your programme" card + "Today's training" section --

  it("hides the programme card + today's training by default (no live plan)", () => {
    const { queryByTestId } = render();
    expect(queryByTestId("home-active-programme")).toBeNull();
    expect(queryByTestId("home-todays-training")).toBeNull();
  });

  it("renders the 'Your programme' card when a live programme is present", () => {
    const { getByTestId, getByText } = render({
      activeProgramme: {
        assignmentId: "pa1",
        programId: "p1",
        name: "Strength Foundations",
        week: 4,
        totalWeeks: 12,
        endDate: "2026-08-01",
        startDate: "2026-05-01",
      },
    });
    expect(getByTestId("home-active-programme")).toBeTruthy();
    expect(getByTestId("home-programme-card")).toBeTruthy();
    expect(getByText("Strength Foundations")).toBeTruthy();
    expect(getByText("Week 4 / 12")).toBeTruthy();
  });

  it("renders 'Today's training' rows with attribution badge + due label, and opens the workout", () => {
    const onOpenWorkout = jest.fn();
    const { getByTestId, getByText } = render({
      onOpenWorkout,
      todayISO: "2026-06-10",
      todaysTraining: [
        {
          assignmentId: "wa1",
          workoutId: "w9",
          name: "Upper Body",
          estimatedDurationMinutes: 45,
          dueDate: "2026-06-10",
          assignedByType: "personal_trainer",
        },
      ],
    });
    expect(getByTestId("home-todays-training")).toBeTruthy();
    expect(getByText("Upper Body")).toBeTruthy();
    expect(getByText("Set by coach")).toBeTruthy();
    expect(getByText("45 min · Today")).toBeTruthy();
    fireEvent.press(getByTestId("todays-training-w9"));
    expect(onOpenWorkout).toHaveBeenCalledWith("w9");
  });

  it("labels an overdue occurrence and omits the badge for self/ad-hoc rows", () => {
    const { getByText, queryByText } = render({
      todayISO: "2026-06-10",
      todaysTraining: [
        {
          assignmentId: "wa2",
          workoutId: "w2",
          name: "Legs",
          estimatedDurationMinutes: null,
          dueDate: "2026-06-08",
          assignedByType: null,
        },
      ],
    });
    expect(getByText("Overdue")).toBeTruthy();
    expect(queryByText("Set by coach")).toBeNull();
  });
});
