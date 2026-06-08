import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { NotificationsListPresenter } from "@/ui/presenters/NotificationsListPresenter";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";
import { NotificationsListContainer } from "../NotificationsListContainer";

jest.mock("@/ui/presenters/NotificationsListPresenter");
const MockPresenter = jest.mocked(NotificationsListPresenter);

MockPresenter.mockImplementation((props) => (
  <View>
    <Text testID="unread">{String(props.unreadCount)}</Text>
    <Text testID="group-count">{String(props.groups.length)}</Text>
    <Text testID="item-count">
      {String(props.groups.reduce((n, g) => n + g.notifications.length, 0))}
    </Text>
    <Text testID="first-title">
      {props.groups[0]?.notifications[0]?.title ?? ""}
    </Text>
    <Text testID="error">{props.error ? props.error.message : ""}</Text>
    <Pressable
      testID="tap"
      onPress={() =>
        props.groups[0] && props.onTap(props.groups[0].notifications[0])
      }
    />
    <Pressable testID="mark-all" onPress={() => props.onMarkAllRead()} />
    <Pressable testID="refresh" onPress={() => props.onRefresh()} />
    <Pressable testID="load-more" onPress={() => props.onLoadMore()} />
    <Pressable testID="back" onPress={() => props.onBack()} />
  </View>
));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    useRouter: () => ({ push: mockPush, back: mockBack }),
    // Run the focus callback like a mount effect (no real navigator in jest).
    useFocusEffect: (cb: () => void | (() => void)) =>
      React.useEffect(cb, [cb]),
  };
});

/** Controllable notifications stub — captures the received listener. */
function makeNotificationsStub() {
  const received: (() => void)[] = [];
  return {
    addNotificationReceivedListener: jest.fn((l: () => void) => {
      received.push(l);
      return () => {};
    }),
    emitReceived: () => received.forEach((l) => l()),
  };
}

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  notifications: ReturnType<typeof makeNotificationsStub>,
): Adapters {
  return {
    api,
    storage,
    auth: {} as Adapters["auth"],
    health: {} as Adapters["health"],
    payments: {} as Adapters["payments"],
    notifications: notifications as unknown as Adapters["notifications"],
    netInfo: {} as Adapters["netInfo"],
  } as Adapters;
}

function renderContainer(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  notifications = makeNotificationsStub(),
) {
  const adapters = makeAdapters(api, storage, notifications);
  const utils = render(<NotificationsListContainer />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    ),
  });
  return { ...utils, notifications };
}

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
});

describe("NotificationsListContainer", () => {
  it("renders the cache synchronously (cache-first)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotifications([
      makeNotification({ id: "c1", title: "Cached one", readAt: null }),
    ]);

    const { getByTestId } = renderContainer(api, storage);
    expect(getByTestId("first-title").props.children).toBe("Cached one");
    expect(getByTestId("unread").props.children).toBe("1");
    // settle the mount refresh
    await waitFor(() => expect(api.getNotificationsCalls.length).toBe(1));
  });

  it("writes the background refresh through to the cache", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notifications = [makeNotification({ id: "srv", title: "From server" })];

    const { getByTestId } = renderContainer(api, storage);
    await waitFor(() =>
      expect(getByTestId("first-title").props.children).toBe("From server"),
    );
  });

  it("tap marks the row read and routes to its deep link", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotifications([
      makeNotification({
        id: "t1",
        readAt: null,
        deepLink: "/(app)/(tabs)/you",
        createdAt: "2026-06-07T11:00:00.000Z", // newest → groups[0].notifications[0]
      }),
      // a second (older) row so the optimistic map iterates a non-tapped row
      makeNotification({ id: "other", createdAt: "2026-06-07T08:00:00.000Z" }),
    ]);

    const { getByTestId } = renderContainer(api, storage);
    expect(getByTestId("unread").props.children).toBe("2");
    fireEvent.press(getByTestId("tap"));

    expect(mockPush).toHaveBeenCalledWith("/(app)/(tabs)/you");
    // optimistic: only the tapped row's unread is cleared
    await waitFor(() => expect(getByTestId("unread").props.children).toBe("1"));
    expect(
      storage.getCachedNotifications().find((n) => n.id === "t1")?.readAt,
    ).not.toBeNull();
    // mark-read enqueued
    expect(storage.getPendingMutations()).toHaveLength(1);
  });

  it("tapping an already-read row does not change the unread count", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotifications([
      makeNotification({
        id: "read1",
        readAt: "2026-06-01T00:00:00.000Z",
        createdAt: "2026-06-07T11:00:00.000Z", // newest → tapped first
      }),
      makeNotification({ id: "unread1", readAt: null }),
    ]);

    const { getByTestId } = renderContainer(api, storage);
    expect(getByTestId("unread").props.children).toBe("1");
    fireEvent.press(getByTestId("tap")); // taps read1
    expect(mockPush).toHaveBeenCalled();
    // unread count unchanged — the tapped row was already read
    await waitFor(() => expect(getByTestId("unread").props.children).toBe("1"));
  });

  it("tap falls back to Home when the notification has no deep link", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotifications([
      makeNotification({ id: "t2", deepLink: null }),
    ]);

    const { getByTestId } = renderContainer(api, storage);
    fireEvent.press(getByTestId("tap"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/(tabs)");
  });

  it("mark-all-read clears the unread count optimistically", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotifications([
      makeNotification({ id: "u1", readAt: null }),
      // a mix: an already-read row must stay read (map keeps it as-is)
      makeNotification({ id: "r1", readAt: "2026-06-01T00:00:00.000Z" }),
    ]);

    const { getByTestId } = renderContainer(api, storage);
    expect(getByTestId("unread").props.children).toBe("1");
    fireEvent.press(getByTestId("mark-all"));
    await waitFor(() => expect(getByTestId("unread").props.children).toBe("0"));
  });

  it("load-more fetches the next page with the stored cursor", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notifications = [makeNotification({ id: "p1" })];
    api.notificationsNextCursor = "cursor-2";

    const { getByTestId } = renderContainer(api, storage);
    await waitFor(() => expect(api.getNotificationsCalls.length).toBe(1));

    fireEvent.press(getByTestId("load-more"));
    await waitFor(() =>
      expect(api.getNotificationsCalls).toContainEqual({ cursor: "cursor-2" }),
    );
  });

  it("grows the visible list across pages (not capped at the cache size)", async () => {
    // Inspector Brad #1 regression: load-more must append OLDER pages to the
    // visible list even though they fall outside the newest-100 the cache
    // LRU keeps. The in-memory adapter returns whatever `notifications` is
    // set to, so we swap it between pages to simulate distinct keyset pages.
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notifications = [
      makeNotification({ id: "new", createdAt: "2026-06-07T09:00:00.000Z" }),
    ];
    api.notificationsNextCursor = "c2";

    const { getByTestId } = renderContainer(api, storage);
    await waitFor(() =>
      expect(getByTestId("item-count").props.children).toBe("1"),
    );

    // Next (older) page.
    api.notifications = [
      makeNotification({ id: "old", createdAt: "2026-05-01T09:00:00.000Z" }),
    ];
    api.notificationsNextCursor = null;
    fireEvent.press(getByTestId("load-more"));

    await waitFor(() =>
      expect(getByTestId("item-count").props.children).toBe("2"),
    );
  });

  it("load-more is a no-op when there is no next cursor", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notificationsNextCursor = null;

    const { getByTestId } = renderContainer(api, storage);
    await waitFor(() => expect(api.getNotificationsCalls.length).toBe(1));
    fireEvent.press(getByTestId("load-more"));
    // still just the mount refresh — no extra fetch
    await waitFor(() => expect(api.getNotificationsCalls.length).toBe(1));
  });

  it("surfaces an error when the background refresh fails", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.shouldFail = true;

    const { getByTestId } = renderContainer(api, storage);
    await waitFor(() =>
      expect(getByTestId("error").props.children).toBe("Test error"),
    );
  });

  it("load-more failure leaves the cursor unchanged (no crash)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notifications = [makeNotification({ id: "p1" })];
    api.notificationsNextCursor = "cursor-2";

    const { getByTestId } = renderContainer(api, storage);
    await waitFor(() => expect(api.getNotificationsCalls.length).toBe(1));

    api.shouldFail = true; // next fetch fails
    fireEvent.press(getByTestId("load-more"));
    await waitFor(() => expect(api.getNotificationsCalls.length).toBe(2));
    // cursor not advanced — a second load-more still requests cursor-2
    api.shouldFail = false;
    fireEvent.press(getByTestId("load-more"));
    await waitFor(() =>
      expect(
        api.getNotificationsCalls.filter((c) => c?.cursor === "cursor-2")
          .length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it("does not clobber an un-flushed optimistic read on refresh (Inspector #5)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    // A mark-read for "x" is queued but not yet flushed.
    storage.enqueueMutation({
      entityType: "notification",
      entityId: "x",
      operation: "update",
      payload: { isRead: true },
      endpoint: "/notifications/x",
      method: "PATCH",
    });
    // The server still returns "x" as UNREAD (the PATCH hasn't landed).
    api.notifications = [makeNotification({ id: "x", readAt: null })];
    api.notificationsUnreadCount = 1;

    const { getByTestId } = renderContainer(api, storage);

    // After the mount refresh, the optimistic read is re-applied: unread 0.
    await waitFor(() => expect(getByTestId("unread").props.children).toBe("0"));
  });

  it("refreshes the open list when a push arrives (Inspector #6)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notifications = [makeNotification({ id: "first", title: "First" })];

    const { getByTestId, notifications } = renderContainer(api, storage);
    await waitFor(() =>
      expect(getByTestId("first-title").props.children).toBe("First"),
    );

    // A push arrives while the screen is open → the received listener fires
    // → the list re-fetches and shows the newest server state.
    api.notifications = [makeNotification({ id: "pushed", title: "Pushed" })];
    act(() => notifications.emitReceived());

    await waitFor(() =>
      expect(getByTestId("first-title").props.children).toBe("Pushed"),
    );
  });

  it("preserves loaded pages when a push arrives mid-pagination (Inspector #7)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notifications = [
      makeNotification({
        id: "p1",
        title: "Page1",
        createdAt: "2026-06-07T11:00:00.000Z",
      }),
    ];
    api.notificationsNextCursor = "c2";

    const { getByTestId, notifications } = renderContainer(api, storage);
    await waitFor(() =>
      expect(getByTestId("item-count").props.children).toBe("1"),
    );

    // Paginate to an older page.
    api.notifications = [
      makeNotification({
        id: "p2",
        title: "Page2",
        createdAt: "2026-06-05T11:00:00.000Z",
      }),
    ];
    api.notificationsNextCursor = null;
    fireEvent.press(getByTestId("load-more"));
    await waitFor(() =>
      expect(getByTestId("item-count").props.children).toBe("2"),
    );

    // A push arrives mid-pagination → MERGE (prepend new), NOT a reset.
    api.notifications = [
      makeNotification({
        id: "fresh",
        title: "Fresh",
        createdAt: "2026-06-07T12:00:00.000Z",
      }),
    ];
    act(() => notifications.emitReceived());

    // Loaded pages preserved + the new row added → 3 (not reset back to 1).
    await waitFor(() =>
      expect(getByTestId("item-count").props.children).toBe("3"),
    );
  });

  it("a push that brings no new rows leaves the list unchanged", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notifications = [makeNotification({ id: "only", title: "Only" })];

    const { getByTestId, notifications } = renderContainer(api, storage);
    await waitFor(() =>
      expect(getByTestId("item-count").props.children).toBe("1"),
    );

    // Same id comes back on the merge → no new rows → list unchanged.
    act(() => notifications.emitReceived());
    await waitFor(() =>
      expect(getByTestId("item-count").props.children).toBe("1"),
    );
  });

  it("back navigates back", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { getByTestId } = renderContainer(api, storage);
    fireEvent.press(getByTestId("back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
