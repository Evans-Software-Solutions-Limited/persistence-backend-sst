import { fireEvent } from "@testing-library/react-native";
import {
  WorkoutCard,
  type WorkoutCardWorkout,
} from "@/ui/components/home/WorkoutCard";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

const base = (
  overrides: Partial<WorkoutCardWorkout> = {},
): WorkoutCardWorkout => ({
  id: "w-1",
  name: "Push Day",
  description: "Chest + shoulders + triceps",
  estimated_duration_minutes: 45,
  exercises: [{}, {}, {}],
  targeted_muscles: [
    { id: "m-1", display_name: "Chest" },
    { id: "m-2", display_name: "Shoulders" },
  ],
  is_assigned: false,
  assigned_by_type: null,
  created_by: "user-1",
  ...overrides,
});

describe("WorkoutCard", () => {
  const noop = jest.fn();

  it("renders the name + description + duration + exercise count", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <WorkoutCard workout={base()} onPress={noop} onStart={noop} />,
    );
    expect(getByTestId("workout-card-w-1")).toBeTruthy();
    expect(getByText("Push Day")).toBeTruthy();
    expect(getByText(/Chest \+ shoulders/)).toBeTruthy();
    expect(getByText("45m")).toBeTruthy();
    expect(getByText("3 exercises")).toBeTruthy();
  });

  it("formats multi-hour durations as h + m", () => {
    const { getByText } = renderWithTheme(
      <WorkoutCard
        workout={base({ estimated_duration_minutes: 125 })}
        onPress={noop}
        onStart={noop}
      />,
    );
    expect(getByText("2h 5m")).toBeTruthy();
  });

  it("formats round-hour durations as just h", () => {
    const { getByText } = renderWithTheme(
      <WorkoutCard
        workout={base({ estimated_duration_minutes: 120 })}
        onPress={noop}
        onStart={noop}
      />,
    );
    expect(getByText("2h")).toBeTruthy();
  });

  it("falls back to 'Untitled workout' when name is null", () => {
    const { getByText } = renderWithTheme(
      <WorkoutCard
        workout={base({ name: null })}
        onPress={noop}
        onStart={noop}
      />,
    );
    expect(getByText("Untitled workout")).toBeTruthy();
  });

  it("fires onPress for the card body and onStart for the play button separately", () => {
    const onPress = jest.fn();
    const onStart = jest.fn();
    const { getByTestId } = renderWithTheme(
      <WorkoutCard workout={base()} onPress={onPress} onStart={onStart} />,
    );
    fireEvent.press(getByTestId("workout-card-w-1-start"));
    expect(onStart).toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("renders the PT assigned tag for personal_trainer", () => {
    const { getByText } = renderWithTheme(
      <WorkoutCard
        workout={base({
          is_assigned: true,
          assigned_by_type: "personal_trainer",
        })}
        onPress={noop}
        onStart={noop}
      />,
    );
    expect(getByText("Assigned by: PT")).toBeTruthy();
  });

  it("renders the Physio assigned tag for physiotherapist", () => {
    const { getByText } = renderWithTheme(
      <WorkoutCard
        workout={base({
          is_assigned: true,
          assigned_by_type: "physiotherapist",
        })}
        onPress={noop}
        onStart={noop}
      />,
    );
    expect(getByText("Assigned by: Physio")).toBeTruthy();
  });

  it("renders the Physio tag for legacy 'physio' literal too", () => {
    const { getByText } = renderWithTheme(
      <WorkoutCard
        workout={base({ is_assigned: true, assigned_by_type: "physio" })}
        onPress={noop}
        onStart={noop}
      />,
    );
    expect(getByText("Assigned by: Physio")).toBeTruthy();
  });

  it("renders up to 3 muscle badges + an overflow '+N' badge", () => {
    const { getByText, queryByText } = renderWithTheme(
      <WorkoutCard
        workout={base({
          targeted_muscles: [
            { id: "m-1", display_name: "Chest" },
            { id: "m-2", display_name: "Shoulders" },
            { id: "m-3", display_name: "Triceps" },
            { id: "m-4", display_name: "Core" },
            { id: "m-5", display_name: "Delts" },
          ],
        })}
        onPress={noop}
        onStart={noop}
      />,
    );
    expect(getByText("Chest")).toBeTruthy();
    expect(getByText("Shoulders")).toBeTruthy();
    expect(getByText("Triceps")).toBeTruthy();
    expect(getByText("+2")).toBeTruthy();
    expect(queryByText("Core")).toBeNull();
  });

  it("falls back to muscle.name / 'Unknown' when display_name is missing", () => {
    const { getByText } = renderWithTheme(
      <WorkoutCard
        workout={base({
          targeted_muscles: [
            { id: "m-1", name: "back" },
            { id: "m-2" } as { id: string },
          ],
        })}
        onPress={noop}
        onStart={noop}
      />,
    );
    expect(getByText("back")).toBeTruthy();
    expect(getByText("Unknown")).toBeTruthy();
  });

  it("renders Edit + Delete actions for the owner when both handlers supplied", () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const { getByTestId } = renderWithTheme(
      <WorkoutCard
        workout={base()}
        currentUserId="user-1"
        onPress={noop}
        onStart={noop}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    fireEvent.press(getByTestId("workout-card-w-1-edit"));
    expect(onEdit).toHaveBeenCalled();
    fireEvent.press(getByTestId("workout-card-w-1-delete"));
    expect(onDelete).toHaveBeenCalled();
  });

  it("hides Edit / Delete for an assigned workout even if owner matches", () => {
    const { queryByTestId } = renderWithTheme(
      <WorkoutCard
        workout={base({ is_assigned: true })}
        currentUserId="user-1"
        onPress={noop}
        onStart={noop}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(queryByTestId("workout-card-w-1-edit")).toBeNull();
    expect(queryByTestId("workout-card-w-1-delete")).toBeNull();
  });

  it("hides Edit / Delete when currentUserId doesn't match the creator", () => {
    const { queryByTestId } = renderWithTheme(
      <WorkoutCard
        workout={base()}
        currentUserId="someone-else"
        onPress={noop}
        onStart={noop}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(queryByTestId("workout-card-w-1-edit")).toBeNull();
  });

  it("suppresses every handler when disabled", () => {
    const onPress = jest.fn();
    const onStart = jest.fn();
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const { getByTestId } = renderWithTheme(
      <WorkoutCard
        workout={base()}
        currentUserId="user-1"
        onPress={onPress}
        onStart={onStart}
        onEdit={onEdit}
        onDelete={onDelete}
        isDisabled
      />,
    );
    fireEvent.press(getByTestId("workout-card-w-1"));
    fireEvent.press(getByTestId("workout-card-w-1-start"));
    fireEvent.press(getByTestId("workout-card-w-1-edit"));
    fireEvent.press(getByTestId("workout-card-w-1-delete"));
    expect(onPress).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("omits the description block when no description provided", () => {
    const { queryByText } = renderWithTheme(
      <WorkoutCard
        workout={base({ description: null })}
        onPress={noop}
        onStart={noop}
      />,
    );
    expect(queryByText(/Chest \+ shoulders/)).toBeNull();
  });

  it("omits the duration block when estimated_duration_minutes is undefined", () => {
    const { queryByText } = renderWithTheme(
      <WorkoutCard
        workout={base({ estimated_duration_minutes: null })}
        onPress={noop}
        onStart={noop}
      />,
    );
    expect(queryByText(/\dm$/)).toBeNull();
  });

  it("exposes an accessible name for the icon-only start button", () => {
    const { getByLabelText } = renderWithTheme(
      <WorkoutCard workout={base()} onPress={noop} onStart={noop} />,
    );
    expect(getByLabelText("Start workout")).toBeTruthy();
  });
});
