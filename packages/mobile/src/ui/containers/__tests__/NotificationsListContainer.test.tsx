import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { NotificationsListPresenter } from "@/ui/presenters/NotificationsListPresenter";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
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
    setBadgeCount: jest.fn(async () => undefined),
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
    // …and NO redundant mark-read enqueued for an already-read row (#9).
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("marks arriving push notifications read when the screen is open (mark-on-view, #8)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    // An old (pre-mark-all) unread row.
    api.notifications = [
      makeNotification({ id: "old", createdAt: "2020-01-01T00:00:00.000Z" }),
    ];
    api.notificationsUnreadCount = 1;

    const { getByTestId, notifications } = renderContainer(api, storage);
    // Mark-on-view: opening the list automatically marks all read → 0.
    await waitFor(() => expect(getByTestId("unread").props.children).toBe("0"));

    // A push arrives while the screen is still open (future createdAt).
    // Since the user is actively viewing the list, this gets marked read too.
    api.notifications = [
      makeNotification({ id: "new", createdAt: "2099-01-01T00:00:00.000Z" }),
      makeNotification({ id: "old", createdAt: "2020-01-01T00:00:00.000Z" }),
    ];
    api.notificationsUnreadCount = 2;
    act(() => notifications.emitReceived());

    // The user is viewing → mark-on-view clears the badge again → 0.
    await waitFor(() => expect(getByTestId("unread").props.children).toBe("0"));
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

  it("tapping a coach_brief routes to the Train hub AND primes the Training segment (M17)", async () => {
    useTrainSegment.setState({
      segment: "Workouts",
      pendingSegment: null,
      hydrated: true,
    });
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotifications([
      makeNotification({
        id: "brief-1",
        type: "coach_brief",
        deepLink: "persistencemobile://train",
      }),
    ]);

    const { getByTestId } = renderContainer(api, storage);
    fireEvent.press(getByTestId("tap"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/(tabs)/train");
    expect(useTrainSegment.getState().pendingSegment).toBe("Training");
    expect(useTrainSegment.getState().segment).toBe("Training");
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

  it("keeps a page-2 mark-read out of the unread count on the next merge (Inspector)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    // The user has optimistically read a row that lives on page 2 (not in
    // the page-1 fetch). Its mark-read sits in the queue.
    storage.enqueueMutation({
      entityType: "notification",
      entityId: "p2row",
      operation: "update",
      payload: { isRead: true },
      endpoint: "/notifications/p2row",
      method: "PATCH",
    });
    // Server page 1 doesn't contain p2row; server total unread still counts
    // it (2) because the PATCH hasn't flushed.
    api.notifications = [makeNotification({ id: "p1row", readAt: null })];
    api.notificationsUnreadCount = 2;

    const { getByTestId, notifications } = renderContainer(api, storage);
    // Mark-on-view: the optimistic unread is 1 (server 2 minus pending read
    // for p2row), then markAllRead fires immediately → settles at 0.
    await waitFor(() => expect(getByTestId("unread").props.children).toBe("0"));

    // A push re-runs the merge — mark-all is pending so everything stays 0.
    act(() => notifications.emitReceived());
    await waitFor(() => expect(getByTestId("unread").props.children).toBe("0"));
  });

  it("load-more ignores a repeat fire while a page is in flight (no dup append)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notifications = [
      makeNotification({ id: "p1", createdAt: "2026-06-07T11:00:00.000Z" }),
    ];
    api.notificationsNextCursor = "c2";

    const { getByTestId } = renderContainer(api, storage);
    await waitFor(() => expect(api.getNotificationsCalls.length).toBe(1));

    api.notifications = [
      makeNotification({ id: "p2", createdAt: "2026-06-05T11:00:00.000Z" }),
    ];
    api.notificationsNextCursor = null;

    // Two rapid onEndReached fires before the first response lands: the
    // second must be a no-op (cursor claimed synchronously).
    fireEvent.press(getByTestId("load-more"));
    fireEvent.press(getByTestId("load-more"));
    await waitFor(() =>
      expect(getByTestId("item-count").props.children).toBe("2"),
    );
    // The cursor was requested exactly once (not twice).
    expect(
      api.getNotificationsCalls.filter((c) => c?.cursor === "c2").length,
    ).toBe(1);
  });

  it("discards a stale loadMore page when a reset lands mid-flight (Inspector #276)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notifications = [
      makeNotification({ id: "p1", createdAt: "2026-06-09T11:00:00.000Z" }),
    ];
    api.notificationsNextCursor = "c2";

    // Hold the loadMore (cursor) fetch open; reset (no cursor) resolves live.
    let resolveLoadMore!: (v: unknown) => void;
    const realGet = api.getNotifications.bind(api);
    jest
      .spyOn(api, "getNotifications")
      .mockImplementation((params?: { cursor?: string }) => {
        if (params?.cursor) {
          return new Promise((res) => {
            resolveLoadMore = res as (v: unknown) => void;
          });
        }
        return realGet(params);
      });

    const { getByTestId } = renderContainer(api, storage);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() =>
      expect(getByTestId("item-count").props.children).toBe("1"),
    );

    // loadMore starts (in-flight against cursor c2).
    await act(async () => {
      fireEvent.press(getByTestId("load-more"));
      await new Promise((r) => setTimeout(r, 0));
    });

    // Pull-to-refresh lands first with a fresh page → bumps the epoch.
    api.notifications = [
      makeNotification({
        id: "fresh",
        title: "Fresh",
        createdAt: "2026-06-09T12:00:00.000Z",
      }),
    ];
    api.notificationsNextCursor = "freshCursor";
    await act(async () => {
      fireEvent.press(getByTestId("refresh"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(getByTestId("first-title").props.children).toBe("Fresh");

    // The stale loadMore now resolves with an OLD page — must be discarded.
    await act(async () => {
      resolveLoadMore(
        ok({
          notifications: [makeNotification({ id: "stale-p2" })],
          nextCursor: "stale3",
          unreadCount: 0,
        }),
      );
      await new Promise((r) => setTimeout(r, 0));
    });

    // Still just the fresh page — the stale older page was NOT spliced in.
    expect(getByTestId("item-count").props.children).toBe("1");
    jest.restoreAllMocks();
  });

  it("back navigates back", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { getByTestId } = renderContainer(api, storage);
    fireEvent.press(getByTestId("back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
