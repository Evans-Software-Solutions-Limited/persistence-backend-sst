import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TrainOverviewPresenter } from "@/ui/presenters/TrainOverviewPresenter";
import type { ActiveProgramme } from "@/domain/models/progress";
import type { HabitConfig } from "@/domain/models/habit-config";

const PROGRAMME: ActiveProgramme = {
  assignmentId: "pa-1",
  programId: "p-1",
  name: "Strength Foundations",
  week: 4,
  totalWeeks: 12,
  endDate: "2026-08-01",
  startDate: "2026-05-01",
  assignedByName: "Coach Jane",
};

const ENABLED_HABITS: HabitConfig[] = [
  {
    category: "water",
    enabled: true,
    goalId: "g1",
    assignedByCoach: true,
    assignedByName: "Coach Jane",
    locked: false,
    targetValue: 2.5,
    unit: "l",
    period: "daily",
    completionRule: "value_gte",
    daysPerWeek: 5,
    tolerancePct: null,
    pending: null,
  },
  {
    category: "gym",
    enabled: true,
    goalId: "g2",
    assignedByCoach: false,
    assignedByName: null,
    locked: false,
    targetValue: 4,
    unit: "×",
    period: "weekly",
    completionRule: "count",
    daysPerWeek: null,
    tolerancePct: null,
    pending: null,
  },
];

function baseProps() {
  return {
    activeProgramme: null,
    todaysTraining: [],
    isRefreshing: false,
    onRefresh: jest.fn(),
    onOpenWorkout: jest.fn(),
    onOpenProgramme: jest.fn(),
    todayISO: "2026-07-09",
  };
}

describe("<TrainOverviewPresenter>", () => {
  it("hides the programme card when there is no active programme", () => {
    const { queryByTestId, getByTestId } = renderWithTheme(
      <TrainOverviewPresenter {...baseProps()} />,
    );
    expect(getByTestId("train-overview-scroll")).toBeTruthy();
    expect(queryByTestId("train-active-programme")).toBeNull();
    // The shared today's-training section renders nothing when empty.
    expect(queryByTestId("train-todays-training")).toBeNull();
  });

  it("shows the programme card with coach attribution", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <TrainOverviewPresenter {...baseProps()} activeProgramme={PROGRAMME} />,
    );
    expect(getByTestId("train-programme-card")).toBeTruthy();
    expect(getByText("Strength Foundations")).toBeTruthy();
  });

  it("shows the targets card with enabled habits as an informative sheet", () => {
    const { getByTestId, getByText, queryByTestId } = renderWithTheme(
      <TrainOverviewPresenter {...baseProps()} habits={ENABLED_HABITS} />,
    );
    expect(getByTestId("train-targets-card")).toBeTruthy();
    expect(getByText("Your targets")).toBeTruthy();
    // Water row
    expect(getByTestId("train-target-water")).toBeTruthy();
    expect(getByText("Water")).toBeTruthy();
    expect(getByText("2.5 l")).toBeTruthy();
    expect(getByText("5 days / week")).toBeTruthy();
    // Gym row
    expect(getByTestId("train-target-gym")).toBeTruthy();
    expect(getByText("Gym")).toBeTruthy();
    expect(getByText("4× / week")).toBeTruthy();
  });

  it("hides the targets card when no habits are enabled", () => {
    const { queryByTestId } = renderWithTheme(
      <TrainOverviewPresenter {...baseProps()} habits={[]} />,
    );
    expect(queryByTestId("train-targets-card")).toBeNull();
  });
});
