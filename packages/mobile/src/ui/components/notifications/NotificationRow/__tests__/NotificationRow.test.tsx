import { fireEvent } from "@testing-library/react-native";
import {
  IconBell,
  IconCheck,
  IconClock,
  IconDumbbell,
  IconMessage,
  IconTarget,
  IconUser,
  IconUsers,
} from "@/ui/components/icons";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";
import {
  NotificationRowPresenter,
  notificationVisual,
} from "../NotificationRow";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";

const NOW = Date.parse("2026-06-07T12:00:00.000Z");

describe("notificationVisual", () => {
  it.each([
    ["workout_assigned", IconDumbbell, "trainer"],
    ["friend_request", IconUsers, "primary"],
    ["pt_request", IconUser, "trainer"],
    ["pt_accepted", IconCheck, "trainer"],
    ["physio_request", IconUser, "primary"],
    ["physio_accepted", IconCheck, "primary"],
    ["workout_reminder", IconClock, "gold"],
    ["goal_milestone", IconTarget, "success"],
    ["trainer_feedback", IconMessage, "trainer"],
    ["coach_brief", IconMessage, "trainer"],
    ["trainer_client_limit_reached", IconUsers, "trainer"],
    ["coach_request_accepted", IconCheck, "trainer"],
  ] as const)("maps %s to its icon + tone", (type, Icon, tone) => {
    const v = notificationVisual(type);
    expect(v.Icon).toBe(Icon);
    expect(v.tone).toBe(tone);
  });

  it("falls back to a neutral bell for an unknown / future type", () => {
    const v = notificationVisual("some_future_type");
    expect(v.Icon).toBe(IconBell);
    expect(v.tone).toBe("neutral");
  });
});

describe("NotificationRowPresenter", () => {
  it("renders title, body and relative time", () => {
    const onPress = jest.fn();
    const { getByText } = renderWithTheme(
      <NotificationRowPresenter
        notification={makeNotification({
          title: "Push Day assigned",
          body: "Your trainer assigned a workout",
          createdAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
        })}
        onPress={onPress}
        now={NOW}
      />,
    );
    expect(getByText("Push Day assigned")).toBeTruthy();
    expect(getByText("Your trainer assigned a workout")).toBeTruthy();
    expect(getByText("3h")).toBeTruthy();
  });

  it("fires onPress when tapped", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <NotificationRowPresenter
        notification={makeNotification({ id: "n-9" })}
        onPress={onPress}
        now={NOW}
      />,
    );
    fireEvent.press(getByTestId("notification-row-n-9"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("prefixes the a11y label with 'Unread' for unread rows", () => {
    const { getByTestId } = renderWithTheme(
      <NotificationRowPresenter
        notification={makeNotification({
          id: "u",
          title: "Workout assigned",
          readAt: null,
        })}
        onPress={jest.fn()}
        now={NOW}
      />,
    );
    expect(getByTestId("notification-row-u").props.accessibilityLabel).toBe(
      "Unread. Workout assigned",
    );
  });

  it("read rows use a plain a11y label (no 'Unread', no selected state)", () => {
    const { getByTestId } = renderWithTheme(
      <NotificationRowPresenter
        notification={makeNotification({
          id: "r",
          title: "Workout assigned",
          readAt: "2026-06-06T00:00:00.000Z",
        })}
        onPress={jest.fn()}
        now={NOW}
      />,
    );
    const row = getByTestId("notification-row-r");
    expect(row.props.accessibilityLabel).toBe("Workout assigned");
    expect(row.props.accessibilityState?.selected).toBeUndefined();
  });

  it("omits the relative time when createdAt is unparseable", () => {
    const { queryByText } = renderWithTheme(
      <NotificationRowPresenter
        notification={makeNotification({
          id: "no-time",
          title: "No timestamp",
          createdAt: "not-a-date",
        })}
        onPress={jest.fn()}
        now={NOW}
      />,
    );
    expect(queryByText("No timestamp")).toBeTruthy();
    // relativeTime → "" → no time node rendered (nothing to assert beyond
    // the row still rendering cleanly)
  });

  it("falls back to a humanised type label when title is empty (unknown type)", () => {
    const { getByText } = renderWithTheme(
      <NotificationRowPresenter
        notification={makeNotification({
          title: "",
          body: "",
          type: "some_future_type",
        })}
        onPress={jest.fn()}
        now={NOW}
      />,
    );
    expect(getByText("Some future type")).toBeTruthy();
  });
});
