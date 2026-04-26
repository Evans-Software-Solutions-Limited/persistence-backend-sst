import { GoalsSection, type Goal } from "@/ui/components/home/GoalsSection";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("GoalsSection", () => {
  const goal = (overrides: Partial<Goal> = {}): Goal => ({
    id: "g-1",
    title: "10,000 Steps",
    current: 4812,
    target: 10000,
    unit: "steps",
    icon: "footsteps",
    ...overrides,
  });

  it("returns null when goals is empty", () => {
    const { queryByTestId } = renderWithTheme(<GoalsSection goals={[]} />);
    expect(queryByTestId("goals-section")).toBeNull();
  });

  it("renders each goal with title + progress text", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <GoalsSection goals={[goal()]} />,
    );
    expect(getByTestId("goal-card-g-1")).toBeTruthy();
    expect(getByText("10,000 Steps")).toBeTruthy();
    expect(getByText("4,812 / 10,000 steps")).toBeTruthy();
  });

  it("renders multiple goals in order", () => {
    const { getByTestId } = renderWithTheme(
      <GoalsSection
        goals={[
          goal({ id: "g-1", title: "Steps" }),
          goal({ id: "g-2", title: "Sleep", current: 8, target: 8 }),
        ]}
      />,
    );
    expect(getByTestId("goal-card-g-1")).toBeTruthy();
    expect(getByTestId("goal-card-g-2")).toBeTruthy();
  });
});
