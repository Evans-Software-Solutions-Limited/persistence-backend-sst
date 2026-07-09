import { fireEvent, renderWithTheme } from "../../../../__tests__/test-utils";
import { TrainOverviewPresenter } from "@/ui/presenters/TrainOverviewPresenter";
import type { ActiveProgramme } from "@/domain/models/progress";
import type { Goal } from "@/domain/models/goal";

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

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: "g-1",
    goalTypeId: "gt-1",
    goalTypeName: "Squat 1RM",
    iconName: null,
    category: null,
    targetValue: null,
    currentValue: null,
    unit: null,
    targetDate: null,
    notes: null,
    priority: 1,
    isActive: true,
    assignedByUserId: null,
    assignedByName: null,
    isCoachAssigned: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

function baseProps() {
  return {
    activeProgramme: null,
    todaysTraining: [],
    goals: [],
    goalsLoading: false,
    isRefreshing: false,
    onRefresh: jest.fn(),
    onOpenWorkout: jest.fn(),
    onAddGoal: jest.fn(),
    onEditGoal: jest.fn(),
    onDeleteGoal: jest.fn(),
    todayISO: "2026-07-09",
  };
}

describe("<TrainOverviewPresenter>", () => {
  it("hides the programme card when there is no active programme", () => {
    const { queryByTestId, getByTestId } = renderWithTheme(
      <TrainOverviewPresenter {...baseProps()} />,
    );
    expect(queryByTestId("train-active-programme")).toBeNull();
    // Goals section always present, with its empty state.
    expect(getByTestId("train-goals-empty")).toBeTruthy();
  });

  it("shows the programme card with coach attribution", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <TrainOverviewPresenter {...baseProps()} activeProgramme={PROGRAMME} />,
    );
    expect(getByTestId("train-programme-card")).toBeTruthy();
    expect(getByText("Strength Foundations")).toBeTruthy();
  });

  it("renders self-set goals with controls and fires add/edit/delete", () => {
    const props = baseProps();
    const { getByTestId } = renderWithTheme(
      <TrainOverviewPresenter {...props} goals={[goal()]} />,
    );
    fireEvent.press(getByTestId("train-add-goal"));
    fireEvent.press(getByTestId("goal-card-g-1-edit"));
    fireEvent.press(getByTestId("goal-card-g-1-delete"));
    expect(props.onAddGoal).toHaveBeenCalledTimes(1);
    expect(props.onEditGoal).toHaveBeenCalledTimes(1);
    expect(props.onDeleteGoal).toHaveBeenCalledTimes(1);
  });

  it("renders coach-assigned goals as view-only (no controls)", () => {
    const { queryByTestId, getByTestId } = renderWithTheme(
      <TrainOverviewPresenter
        {...baseProps()}
        goals={[
          goal({
            id: "g-2",
            isCoachAssigned: true,
            assignedByUserId: "coach-1",
            assignedByName: "Coach Jane",
          }),
        ]}
      />,
    );
    expect(getByTestId("goal-card-g-2-coach")).toBeTruthy();
    expect(queryByTestId("goal-card-g-2-edit")).toBeNull();
    expect(queryByTestId("goal-card-g-2-delete")).toBeNull();
  });

  it("shows a loader while goals are loading with no cache", () => {
    const { getByTestId } = renderWithTheme(
      <TrainOverviewPresenter {...baseProps()} goalsLoading />,
    );
    expect(getByTestId("train-goals-loading")).toBeTruthy();
  });
});
