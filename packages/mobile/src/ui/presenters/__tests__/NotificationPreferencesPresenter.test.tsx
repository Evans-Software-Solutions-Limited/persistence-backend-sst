import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  NotificationPreferencesPresenter,
  type NotificationPreferencesProps,
} from "../NotificationPreferencesPresenter";

function makeProps(
  overrides: Partial<NotificationPreferencesProps> = {},
): NotificationPreferencesProps {
  return {
    preferences: { workout_assigned: true, goal_milestone: false },
    onToggle: jest.fn(),
    permissionGranted: true,
    onOpenSettings: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  };
}

describe("NotificationPreferencesPresenter", () => {
  it("renders every category and its type rows", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <NotificationPreferencesPresenter {...makeProps()} />,
    );
    expect(getByText("Workouts")).toBeTruthy();
    expect(getByText("Goals")).toBeTruthy();
    expect(getByText("Trainer & Physio")).toBeTruthy();
    expect(getByText("Social")).toBeTruthy();
    expect(getByTestId("pref-row-workout_assigned")).toBeTruthy();
    expect(getByTestId("pref-row-friend_request")).toBeTruthy();
  });

  it("reflects the preference map in each switch (missing key defaults on)", () => {
    const { getByTestId } = renderWithTheme(
      <NotificationPreferencesPresenter {...makeProps()} />,
    );
    expect(getByTestId("pref-switch-workout_assigned").props.value).toBe(true);
    expect(getByTestId("pref-switch-goal_milestone").props.value).toBe(false);
    // not present in the map → defaults to on
    expect(getByTestId("pref-switch-workout_reminder").props.value).toBe(true);
  });

  it("toggling a row calls onToggle with the type and next value", () => {
    const onToggle = jest.fn();
    const { getByTestId } = renderWithTheme(
      <NotificationPreferencesPresenter {...makeProps({ onToggle })} />,
    );
    fireEvent(getByTestId("pref-switch-goal_milestone"), "valueChange", true);
    expect(onToggle).toHaveBeenCalledWith("goal_milestone", true);
  });

  it("shows the permission banner when notifications are off and opens settings", () => {
    const onOpenSettings = jest.fn();
    const { getByTestId } = renderWithTheme(
      <NotificationPreferencesPresenter
        {...makeProps({ permissionGranted: false, onOpenSettings })}
      />,
    );
    const banner = getByTestId("notifications-permission-banner");
    fireEvent.press(banner);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("hides the permission banner when granted", () => {
    const { queryByTestId } = renderWithTheme(
      <NotificationPreferencesPresenter {...makeProps()} />,
    );
    expect(queryByTestId("notifications-permission-banner")).toBeNull();
  });

  it("fires onBack from the leading back button", () => {
    const onBack = jest.fn();
    const { getByLabelText } = renderWithTheme(
      <NotificationPreferencesPresenter {...makeProps({ onBack })} />,
    );
    fireEvent.press(getByLabelText("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
