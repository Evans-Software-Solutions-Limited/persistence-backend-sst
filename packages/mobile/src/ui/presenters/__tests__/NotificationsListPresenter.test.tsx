import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  NotificationsListPresenter,
  type NotificationsListProps,
  flattenGroups,
} from "../NotificationsListPresenter";
import type { NotificationGroup } from "@/application/notifications/grouping";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";

const NOW = Date.parse("2026-06-07T12:00:00.000Z");

const GROUPS: NotificationGroup[] = [
  {
    label: "Today",
    notifications: [
      makeNotification({ id: "a", title: "Workout assigned", readAt: null }),
    ],
  },
  {
    label: "Yesterday",
    notifications: [makeNotification({ id: "b", title: "Goal milestone hit" })],
  },
];

function makeProps(
  overrides: Partial<NotificationsListProps> = {},
): NotificationsListProps {
  return {
    groups: GROUPS,
    unreadCount: 1,
    isRefreshing: false,
    isLoading: false,
    error: null,
    onTap: jest.fn(),
    onMarkAllRead: jest.fn(),
    onRefresh: jest.fn(),
    onLoadMore: jest.fn(),
    onBack: jest.fn(),
    now: NOW,
    ...overrides,
  };
}

describe("flattenGroups", () => {
  it("interleaves section headers and rows", () => {
    const items = flattenGroups(GROUPS);
    expect(items.map((i) => i.kind)).toEqual([
      "section",
      "row",
      "section",
      "row",
    ]);
  });

  it("returns [] for no groups", () => {
    expect(flattenGroups([])).toEqual([]);
  });
});

describe("NotificationsListPresenter", () => {
  it("renders date sections and rows", () => {
    const { getByText } = renderWithTheme(
      <NotificationsListPresenter {...makeProps()} />,
    );
    // Section eyebrow uppercases via CSS textTransform; the text node is
    // still the literal label.
    expect(getByText("Today")).toBeTruthy();
    expect(getByText("Yesterday")).toBeTruthy();
    expect(getByText("Workout assigned")).toBeTruthy();
    expect(getByText("Goal milestone hit")).toBeTruthy();
    expect(getByText("1 UNREAD")).toBeTruthy();
  });

  it("shows the empty state when there are no groups", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <NotificationsListPresenter
        {...makeProps({ groups: [], unreadCount: 0 })}
      />,
    );
    expect(getByTestId("notifications-empty")).toBeTruthy();
    expect(getByText("No notifications yet")).toBeTruthy();
    expect(getByText("Check back after a workout 💪")).toBeTruthy();
  });

  it("suppresses the empty state while loading", () => {
    const { queryByTestId } = renderWithTheme(
      <NotificationsListPresenter
        {...makeProps({ groups: [], isLoading: true })}
      />,
    );
    expect(queryByTestId("notifications-empty")).toBeNull();
  });

  it("shows the error copy in the empty state when a refresh failed", () => {
    const { getByText } = renderWithTheme(
      <NotificationsListPresenter
        {...makeProps({ groups: [], unreadCount: 0, error: new Error("x") })}
      />,
    );
    expect(getByText("Couldn't refresh — showing what we have.")).toBeTruthy();
  });

  it("fires onMarkAllRead from the header check button when there are unread rows", () => {
    const onMarkAllRead = jest.fn();
    const { getByLabelText } = renderWithTheme(
      <NotificationsListPresenter {...makeProps({ onMarkAllRead })} />,
    );
    fireEvent.press(getByLabelText("Mark all read"));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it("hides the mark-all button when there are no unread rows", () => {
    const { queryByLabelText } = renderWithTheme(
      <NotificationsListPresenter {...makeProps({ unreadCount: 0 })} />,
    );
    expect(queryByLabelText("Mark all read")).toBeNull();
  });

  it("fires onBack from the leading back button", () => {
    const onBack = jest.fn();
    const { getByLabelText } = renderWithTheme(
      <NotificationsListPresenter {...makeProps({ onBack })} />,
    );
    fireEvent.press(getByLabelText("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("fires onTap with the tapped notification", () => {
    const onTap = jest.fn();
    const { getByTestId } = renderWithTheme(
      <NotificationsListPresenter {...makeProps({ onTap })} />,
    );
    fireEvent.press(getByTestId("notification-row-a"));
    expect(onTap).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("fires onRefresh from pull-to-refresh", () => {
    const onRefresh = jest.fn();
    const { getByTestId } = renderWithTheme(
      <NotificationsListPresenter {...makeProps({ onRefresh })} />,
    );
    fireEvent(getByTestId("notifications-list"), "refresh");
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
