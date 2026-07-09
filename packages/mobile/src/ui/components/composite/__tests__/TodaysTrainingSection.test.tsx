import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { TodaysTrainingSection } from "@/ui/components/composite/TodaysTrainingSection";
import type { TodaysTrainingItem } from "@/domain/models/progress";

function item(over: Partial<TodaysTrainingItem> = {}): TodaysTrainingItem {
  return {
    assignmentId: "a-1",
    workoutId: "w-1",
    name: "Lower A",
    estimatedDurationMinutes: 45,
    dueDate: "2026-07-09",
    assignedByType: "personal_trainer",
    assignedByName: "Coach Jane",
    ...over,
  };
}

const TODAY = "2026-07-09";

describe("<TodaysTrainingSection>", () => {
  it("renders nothing when empty", () => {
    const { queryByTestId } = renderWithTheme(
      <TodaysTrainingSection
        items={[]}
        onOpenWorkout={jest.fn()}
        testID="train-todays-training"
      />,
    );
    expect(queryByTestId("train-todays-training")).toBeNull();
  });

  it("renders a named coach-attribution line + Today due label", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <TodaysTrainingSection
        items={[item()]}
        onOpenWorkout={jest.fn()}
        todayISO={TODAY}
        testID="train-todays-training"
      />,
    );
    expect(getByText("Lower A")).toBeTruthy();
    expect(getByTestId("todays-training-w-1-coach")).toBeTruthy();
    expect(getByText(/45 min · Today/)).toBeTruthy();
  });

  it("shows a fallback pill when the coach name is unresolved", () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <TodaysTrainingSection
        items={[item({ assignedByName: null })]}
        onOpenWorkout={jest.fn()}
        todayISO={TODAY}
      />,
    );
    expect(getByText("Set by coach")).toBeTruthy();
    expect(queryByTestId("todays-training-w-1-coach")).toBeNull();
  });

  it("attributes a physio with the role-neutral 'Set by' prefix", () => {
    const { getByText } = renderWithTheme(
      <TodaysTrainingSection
        items={[
          item({ assignedByType: "physiotherapist", assignedByName: "Dr Lee" }),
        ]}
        onOpenWorkout={jest.fn()}
        todayISO={TODAY}
      />,
    );
    expect(getByText(/Set by/)).toBeTruthy();
    expect(getByText("Dr Lee")).toBeTruthy();
  });

  it("shows the physio fallback pill when the name is unresolved", () => {
    const { getByText } = renderWithTheme(
      <TodaysTrainingSection
        items={[
          item({ assignedByType: "physiotherapist", assignedByName: null }),
        ]}
        onOpenWorkout={jest.fn()}
        todayISO={TODAY}
      />,
    );
    expect(getByText("From physio")).toBeTruthy();
  });

  it("marks a past due date Overdue and fires onOpenWorkout", () => {
    const onOpen = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      <TodaysTrainingSection
        items={[item({ dueDate: "2026-07-01", assignedByType: null })]}
        onOpenWorkout={onOpen}
        todayISO={TODAY}
      />,
    );
    expect(getByText(/Overdue/)).toBeTruthy();
    fireEvent.press(getByTestId("todays-training-w-1"));
    expect(onOpen).toHaveBeenCalledWith("w-1");
  });
});
