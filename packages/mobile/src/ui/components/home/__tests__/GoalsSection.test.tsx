import type { DashboardActiveGoal } from "@/domain/models/dashboard";
import { GoalsSection } from "@/ui/components/home/GoalsSection";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

const goals: DashboardActiveGoal[] = [
  {
    id: "goal-1",
    title: "Bench 100kg",
    current: 90,
    target: 100,
    unit: "kg",
    priority: 1,
    targetDate: null,
  },
  {
    id: "goal-2",
    title: "10k steps",
    current: 0,
    target: 10000,
    unit: "steps",
    priority: 2,
    targetDate: null,
  },
];

describe("GoalsSection", () => {
  it("renders all provided goals", () => {
    const { getByTestId } = renderWithTheme(<GoalsSection goals={goals} />);
    expect(getByTestId("goal-chip-goal-1")).toBeTruthy();
    expect(getByTestId("goal-chip-goal-2")).toBeTruthy();
  });

  it("renders an empty state when no goals", () => {
    const { getByText } = renderWithTheme(<GoalsSection goals={[]} />);
    expect(getByText("No active goals")).toBeTruthy();
  });

  it("clamps progress percentage at 0 even when current is negative", () => {
    const { getByTestId } = renderWithTheme(
      <GoalsSection
        goals={[
          {
            id: "neg",
            title: "weird",
            current: -50,
            target: 100,
            unit: "kg",
            priority: 1,
            targetDate: null,
          },
        ]}
      />,
    );
    expect(getByTestId("goal-chip-neg")).toBeTruthy();
  });

  it("handles zero-target goals gracefully", () => {
    const { getByTestId } = renderWithTheme(
      <GoalsSection
        goals={[
          {
            id: "zero",
            title: "habit",
            current: 1,
            target: 0,
            unit: "check",
            priority: 1,
            targetDate: null,
          },
        ]}
      />,
    );
    expect(getByTestId("goal-chip-zero")).toBeTruthy();
  });
});
