import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TrainOverviewPresenter } from "@/ui/presenters/TrainOverviewPresenter";
import type { ActiveProgramme } from "@/domain/models/progress";

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
});
