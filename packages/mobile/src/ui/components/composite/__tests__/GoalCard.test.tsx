import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { GoalCard } from "@/ui/components/composite/GoalCard";
import type { Goal } from "@/domain/models/goal";

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: "g-1",
    goalTypeId: "gt-1",
    goalTypeName: "Squat 1RM",
    iconName: "barbell",
    category: "strength",
    targetValue: null,
    currentValue: null,
    unit: null,
    targetDate: "2026-12-31",
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

describe("<GoalCard>", () => {
  it("renders the type name + target date and self-set controls", () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      <GoalCard goal={goal()} onEdit={onEdit} onDelete={onDelete} />,
    );

    expect(getByText("Squat 1RM")).toBeTruthy();
    expect(getByText("Target 2026-12-31")).toBeTruthy();

    fireEvent.press(getByTestId("goal-card-g-1-edit"));
    fireEvent.press(getByTestId("goal-card-g-1-delete"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("renders a value+unit target when set", () => {
    const { getByText } = renderWithTheme(
      <GoalCard
        goal={goal({ targetValue: 100, unit: "kg", targetDate: null })}
      />,
    );
    expect(getByText("100 kg")).toBeTruthy();
  });

  it("coach-assigned goals show the attribution badge and NO controls", () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const { getByTestId, queryByTestId } = renderWithTheme(
      <GoalCard
        goal={goal({
          isCoachAssigned: true,
          assignedByUserId: "coach-1",
          assignedByName: "Coach Jane",
        })}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    // Attribution badge present; edit/delete hard-gated off even with handlers.
    expect(getByTestId("goal-card-g-1-coach")).toBeTruthy();
    expect(queryByTestId("goal-card-g-1-edit")).toBeNull();
    expect(queryByTestId("goal-card-g-1-delete")).toBeNull();
  });

  it("falls back to 'Goal' when the type name is missing", () => {
    const { getByText } = renderWithTheme(
      <GoalCard goal={goal({ goalTypeName: null, targetDate: null })} />,
    );
    expect(getByText("Goal")).toBeTruthy();
  });
});
