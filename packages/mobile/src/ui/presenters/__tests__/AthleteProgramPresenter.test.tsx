import { renderWithTheme, fireEvent } from "../../../../__tests__/test-utils";
import { AthleteProgramPresenter } from "../AthleteProgramPresenter";
import type { AthleteProgramDetail } from "@/domain/models/program";
import type { ApiError } from "@/shared/errors";

const PROGRAM: AthleteProgramDetail = {
  id: "prog-1",
  name: "Hypertrophy Block",
  description: "Upper/lower split, 8 weeks.",
  durationWeeks: 8,
  daysPerWeek: 4,
  workoutCount: 2,
  status: "started",
  startDate: "2026-07-01",
  endDate: "2026-08-26",
  week: 2,
  workouts: [
    {
      id: "pw-1",
      workoutId: "w-a",
      position: 0,
      name: "Upper A",
      estimatedDurationMinutes: 55,
    },
    {
      id: "pw-2",
      workoutId: "w-b",
      position: 1,
      name: "Lower A",
      estimatedDurationMinutes: null,
    },
  ],
};

function baseProps(over: Record<string, unknown> = {}) {
  return {
    program: PROGRAM,
    isLoading: false,
    isRefreshing: false,
    error: null as ApiError | null,
    onRefresh: jest.fn(),
    onBack: jest.fn(),
    onOpenWorkout: jest.fn(),
    ...over,
  };
}

describe("AthleteProgramPresenter", () => {
  it("renders the programme summary + its ordered workout list", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <AthleteProgramPresenter {...baseProps()} />,
    );
    expect(getByTestId("athlete-program-card")).toBeTruthy();
    expect(getByTestId("athlete-program-workouts")).toBeTruthy();
    expect(getByText("Upper A")).toBeTruthy();
    expect(getByText("Lower A")).toBeTruthy();
    // Duration shown when present.
    expect(getByText("55 min")).toBeTruthy();
    expect(getByTestId("athlete-program-description")).toBeTruthy();
  });

  it("tapping a workout opens it (start flow)", () => {
    const onOpenWorkout = jest.fn();
    const { getByTestId } = renderWithTheme(
      <AthleteProgramPresenter {...baseProps({ onOpenWorkout })} />,
    );
    fireEvent.press(getByTestId("athlete-program-workout-w-a"));
    expect(onOpenWorkout).toHaveBeenCalledWith("w-a");
  });

  it("back fires onBack", () => {
    const onBack = jest.fn();
    const { getByTestId } = renderWithTheme(
      <AthleteProgramPresenter {...baseProps({ onBack })} />,
    );
    fireEvent.press(getByTestId("athlete-program-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows a loader while the first fetch is in flight", () => {
    const { getByTestId } = renderWithTheme(
      <AthleteProgramPresenter
        {...baseProps({ program: null, isLoading: true })}
      />,
    );
    expect(getByTestId("athlete-program-loader")).toBeTruthy();
  });

  it("shows an error state with retry when the fetch fails and there is nothing cached", () => {
    const onRefresh = jest.fn();
    const { getByTestId } = renderWithTheme(
      <AthleteProgramPresenter
        {...baseProps({
          program: null,
          error: {
            kind: "api",
            code: "not_found",
            message: "Programme not found",
            status: 404,
          } as ApiError,
          onRefresh,
        })}
      />,
    );
    expect(getByTestId("athlete-program-error")).toBeTruthy();
  });

  it("shows an empty state when the programme has no workouts", () => {
    const { getByTestId } = renderWithTheme(
      <AthleteProgramPresenter
        {...baseProps({ program: { ...PROGRAM, workouts: [] } })}
      />,
    );
    expect(getByTestId("athlete-program-empty")).toBeTruthy();
  });
});
