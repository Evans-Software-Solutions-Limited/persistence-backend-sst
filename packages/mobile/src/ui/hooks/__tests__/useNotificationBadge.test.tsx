import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  NotificationError,
  NotificationsPort,
} from "@/domain/ports/notifications.port";
import { ok, type Result } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useNotificationBadge } from "@/ui/hooks/useNotificationBadge";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";

class StubNotifications implements NotificationsPort {
  badgeCounts: number[] = [];
  badgeRejects = false;
  receivedListeners: (() => void)[] = [];

  async requestPermissions(): Promise<
    Result<"granted" | "denied", NotificationError>
  > {
    return ok("granted");
  }
  async getPermissionStatus() {
    return "granted" as const;
  }
  async getDevicePushToken(): Promise<Result<string, NotificationError>> {
    return ok("tok");
  }
  async scheduleLocalNotification() {
    return "id";
  }
  async cancelLocalNotification() {}
  async setBadgeCount(count: number) {
    if (this.badgeRejects) throw new Error("no permission");
    this.badgeCounts.push(count);
  }
  addPushTokenListener() {
    return () => {};
  }
  addNotificationReceivedListener(listener: () => void) {
    this.receivedListeners.push(listener);
    return () => {};
  }
  addNotificationResponseListener() {
    return () => {};
  }
  async getLastNotificationResponse() {
    return null;
  }
  emitReceived() {
    this.receivedListeners.forEach((l) => l());
  }
}

const SESSION: AuthSession = {
  accessToken: "t",
  refreshToken: "r",
  userId: "user-1",
  email: "u@example.com",
  expiresAt: Date.now() + 60_000,
};

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  notifications: NotificationsPort,
  session: AuthSession | null,
): Adapters {
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => session?.accessToken ?? null),
  } as unknown as Adapters["auth"];
  return {
    api,
    auth,
    storage,
    notifications,
    health: {} as Adapters["health"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  } as Adapters;
}

function wrapperFor(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("useNotificationBadge", () => {
  it("sets the OS badge to the server unread count on mount", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubNotifications();
    api.notificationsUnreadCount = 3;

    renderHook(() => useNotificationBadge(true), {
      wrapper: wrapperFor(makeAdapters(api, storage, notifications, SESSION)),
    });

    await waitFor(() => expect(notifications.badgeCounts).toContain(3));
  });

  it("does not clobber an acknowledged mark-all — uses the optimistic count, not the stale server total", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubNotifications();
    // Optimistic mark-all: cache all read + a queued PATCH /notifications/all.
    storage.cacheNotifications([
      makeNotification({ id: "a", readAt: "2026-06-09T00:00:00.000Z" }),
    ]);
    storage.enqueueMutation({
      entityType: "notification",
      operation: "update",
      payload: {},
      endpoint: "/notifications/all",
      method: "PATCH",
    });
    // Server is blind to the un-flushed mark-all → still reports 3.
    api.notificationsUnreadCount = 3;

    renderHook(() => useNotificationBadge(true), {
      wrapper: wrapperFor(makeAdapters(api, storage, notifications, SESSION)),
    });

    // Badge must reflect the optimistic 0, never the stale server 3.
    await waitFor(() =>
      expect(notifications.badgeCounts.length).toBeGreaterThan(0),
    );
    expect(notifications.badgeCounts).toEqual([0]);
  });

  it("re-syncs on app foreground (AppState 'active')", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubNotifications();
    api.notificationsUnreadCount = 1;
    const addSpy = jest.spyOn(AppState, "addEventListener");

    renderHook(() => useNotificationBadge(true), {
      wrapper: wrapperFor(makeAdapters(api, storage, notifications, SESSION)),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(notifications.badgeCounts).toContain(1);

    api.notificationsUnreadCount = 4;
    // Grab the LAST 'change' handler registered after the spy was installed —
    // this hook's listener (avoids picking up a sibling's stale handler in a
    // full-suite run).
    const change = addSpy.mock.calls
      .filter((c) => c[0] === "change")
      .at(-1)?.[1] as (s: string) => void;
    await act(async () => {
      change("active");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(notifications.badgeCounts).toContain(4);
    addSpy.mockRestore();
  });

  it("re-syncs when a push is received while foregrounded", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubNotifications();
    api.notificationsUnreadCount = 2;

    renderHook(() => useNotificationBadge(true), {
      wrapper: wrapperFor(makeAdapters(api, storage, notifications, SESSION)),
    });
    await waitFor(() => expect(notifications.receivedListeners.length).toBe(1));
    api.notificationsUnreadCount = 5;
    await act(async () => {
      notifications.emitReceived();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(notifications.badgeCounts).toContain(5);
  });

  it("never throws when the badge write is rejected (permission denied)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubNotifications();
    notifications.badgeRejects = true;
    api.notificationsUnreadCount = 1;

    renderHook(() => useNotificationBadge(true), {
      wrapper: wrapperFor(makeAdapters(api, storage, notifications, SESSION)),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(notifications.badgeCounts).toEqual([]); // rejected, swallowed
  });

  it("defaults to enabled when called with no argument", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubNotifications();
    api.notificationsUnreadCount = 7;
    renderHook(() => useNotificationBadge(), {
      wrapper: wrapperFor(makeAdapters(api, storage, notifications, SESSION)),
    });
    await waitFor(() => expect(notifications.badgeCounts).toContain(7));
  });

  it("never touches the badge when the server count refresh fails", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubNotifications();
    api.shouldFail = true;
    renderHook(() => useNotificationBadge(true), {
      wrapper: wrapperFor(makeAdapters(api, storage, notifications, SESSION)),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(notifications.badgeCounts).toEqual([]);
  });

  it("ignores AppState transitions other than 'active'", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubNotifications();
    api.notificationsUnreadCount = 1;
    const addSpy = jest.spyOn(AppState, "addEventListener");
    renderHook(() => useNotificationBadge(true), {
      wrapper: wrapperFor(makeAdapters(api, storage, notifications, SESSION)),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const before = notifications.badgeCounts.length;
    const change = addSpy.mock.calls
      .filter((c) => c[0] === "change")
      .at(-1)?.[1] as (s: string) => void;
    api.notificationsUnreadCount = 9;
    await act(async () => {
      change("background");
      await new Promise((r) => setTimeout(r, 0));
    });
    // Backgrounding must not re-sync — no new badge write, and never the 9.
    expect(notifications.badgeCounts.length).toBe(before);
    expect(notifications.badgeCounts).not.toContain(9);
    addSpy.mockRestore();
  });

  it("is a no-op when disabled or signed out", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const disabled = new StubNotifications();
    renderHook(() => useNotificationBadge(false), {
      wrapper: wrapperFor(makeAdapters(api, storage, disabled, SESSION)),
    });
    const signedOut = new StubNotifications();
    renderHook(() => useNotificationBadge(true), {
      wrapper: wrapperFor(makeAdapters(api, storage, signedOut, null)),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(disabled.badgeCounts).toEqual([]);
    expect(signedOut.badgeCounts).toEqual([]);
  });
});
