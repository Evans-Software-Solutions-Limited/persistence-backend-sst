import { fireEvent } from "@testing-library/react-native";
import type { DashboardPROfTheWeek } from "@/domain/models/dashboard";
import { PROfTheWeekCard } from "@/ui/components/home/PROfTheWeekCard";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

const pr: DashboardPROfTheWeek = {
  exerciseId: "ex-bench",
  exerciseName: "Barbell Bench Press",
  recordType: "1rm",
  value: 100,
  unit: "kg",
  achievedAt: new Date().toISOString(),
};

describe("PROfTheWeekCard", () => {
  it("renders the exercise name + value + record-type label", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <PROfTheWeekCard pr={pr} />,
    );
    expect(getByTestId("pr-of-the-week")).toBeTruthy();
    expect(getByText("Barbell Bench Press")).toBeTruthy();
    expect(getByText("100 kg")).toBeTruthy();
    expect(getByText("1 Rep Max")).toBeTruthy();
  });

  it("wraps the card in a Pressable when onPress is provided", () => {
    const onPress = jest.fn();
    const { getByText } = renderWithTheme(
      <PROfTheWeekCard pr={pr} onPress={onPress} />,
    );
    fireEvent.press(getByText("Barbell Bench Press"));
    expect(onPress).toHaveBeenCalled();
  });

  it("renders all the other record-type labels without crashing", () => {
    (
      [
        "3rm",
        "5rm",
        "10rm",
        "max_weight",
        "max_reps",
        "best_time",
        "longest_distance",
      ] as const
    ).forEach((rt) => {
      const { getByTestId } = renderWithTheme(
        <PROfTheWeekCard pr={{ ...pr, recordType: rt }} />,
      );
      expect(getByTestId("pr-of-the-week")).toBeTruthy();
    });
  });
});
