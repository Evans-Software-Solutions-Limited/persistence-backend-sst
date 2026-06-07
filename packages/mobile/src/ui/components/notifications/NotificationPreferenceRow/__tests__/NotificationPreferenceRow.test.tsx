import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";
import { NotificationPreferenceRow } from "../NotificationPreferenceRow";

describe("NotificationPreferenceRow", () => {
  it("renders the type label and a switch in the on state", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <NotificationPreferenceRow
        type="workout_assigned"
        enabled
        onToggle={jest.fn()}
      />,
    );
    expect(getByText("Workout assigned")).toBeTruthy();
    expect(getByTestId("pref-switch-workout_assigned").props.value).toBe(true);
  });

  it("fires onToggle with the next value", () => {
    const onToggle = jest.fn();
    const { getByTestId } = renderWithTheme(
      <NotificationPreferenceRow
        type="goal_milestone"
        enabled={false}
        onToggle={onToggle}
      />,
    );
    fireEvent(getByTestId("pref-switch-goal_milestone"), "valueChange", true);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("renders a trainer-tone row (accentTrainer token family)", () => {
    const { getByTestId } = renderWithTheme(
      <NotificationPreferenceRow
        type="pt_request"
        enabled
        onToggle={jest.fn()}
      />,
    );
    expect(getByTestId("pref-row-pt_request")).toBeTruthy();
  });

  it("disables the switch when disabled", () => {
    const { getByTestId } = renderWithTheme(
      <NotificationPreferenceRow
        type="friend_request"
        enabled
        onToggle={jest.fn()}
        disabled
      />,
    );
    expect(getByTestId("pref-switch-friend_request").props.disabled).toBe(true);
  });
});
