import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
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
import { useUnreadNotificationCount } from "@/ui/hooks/useUnreadNotificationCount";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";

// useFocusEffect needs a navigator at runtime; in a bare renderHook we map it
// to a plain effect so the focus-sync path still exercises.
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void | (() => void)) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").useEffect(cb, [cb]),
}));

class StubNotifications implements NotificationsPort {
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
  async setBadgeCount() {}
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

describe("useUnreadNotificationCount", () => {
  it("returns the server unread count on mount", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notificationsUnreadCount = 3;

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: wrapperFor(
        makeAdapters(api, storage, new StubNotifications(), SESSION),
      ),
    });

    await waitFor(() => expect(result.current).toBe(3));
  });

  it("reflects the optimistic 0 after a pending mark-all, not the stale server total", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
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
    api.notificationsUnreadCount = 3;

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: wrapperFor(
        makeAdapters(api, storage, new StubNotifications(), SESSION),
      ),
    });

    await waitFor(() => expect(result.current).toBe(0));
  });

  it("re-syncs when a push is received while foregrounded", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubNotifications();
    api.notificationsUnreadCount = 2;

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: wrapperFor(makeAdapters(api, storage, notifications, SESSION)),
    });
    await waitFor(() => expect(result.current).toBe(2));

    api.notificationsUnreadCount = 6;
    await act(async () => {
      notifications.emitReceived();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current).toBe(6);
  });

  it("does not sync when signed out (stays at the cache seed of 0)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.notificationsUnreadCount = 9;

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: wrapperFor(
        makeAdapters(api, storage, new StubNotifications(), null),
      ),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current).toBe(0);
  });
});
