import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import type {
  NotificationError,
  NotificationResponseInfo,
  NotificationsPort,
} from "@/domain/ports/notifications.port";
import { ok, type Result } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useNotificationDeepLink } from "@/ui/hooks/useNotificationDeepLink";

class StubNotifications implements NotificationsPort {
  // null = normal cold launch (no tap); { id, deepLink } = launched by a tap.
  coldStart: NotificationResponseInfo | null = null;
  responseListeners: ((r: NotificationResponseInfo) => void)[] = [];

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
  addPushTokenListener() {
    return () => {};
  }
  addNotificationReceivedListener() {
    return () => {};
  }
  addNotificationResponseListener(
    listener: (r: NotificationResponseInfo) => void,
  ) {
    this.responseListeners.push(listener);
    return () => {
      this.responseListeners = this.responseListeners.filter(
        (l) => l !== listener,
      );
    };
  }
  async getLastNotificationResponse() {
    return this.coldStart;
  }
  emitResponse(response: NotificationResponseInfo) {
    this.responseListeners.forEach((l) => l(response));
  }
}

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

function wrapperFor(notifications: NotificationsPort) {
  const adapters = {
    api: {},
    auth: {},
    storage: {},
    notifications,
    health: {},
    payments: {},
    netInfo: {},
  } as unknown as Adapters;
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

beforeEach(() => mockPush.mockClear());

describe("useNotificationDeepLink", () => {
  it("routes the cold-start notification's deep link once (legacy remap), and not again on re-render", async () => {
    const notifications = new StubNotifications();
    notifications.coldStart = { id: "cold-1", deepLink: "/progress" };
    // No explicit arg → exercises the `enabled = true` default.
    const { rerender } = renderHook(() => useNotificationDeepLink(), {
      wrapper: wrapperFor(notifications),
    });
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/(app)/(tabs)/you"),
    );
    // A re-render must not re-dispatch the cold-start (handledColdStartRef).
    rerender(undefined);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("cancels the in-flight cold-start read on unmount", async () => {
    const notifications = new StubNotifications();
    notifications.coldStart = { id: "cold-1", deepLink: "/progress" };
    const { unmount } = renderHook(() => useNotificationDeepLink(true), {
      wrapper: wrapperFor(notifications),
    });
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    // resolved after unmount → cancelled guard short-circuits the push
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not navigate on a normal cold launch (no launching notification)", async () => {
    const notifications = new StubNotifications();
    notifications.coldStart = null;
    renderHook(() => useNotificationDeepLink(true), {
      wrapper: wrapperFor(notifications),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("routes a cold-start tap with NO deep link to Home (AC 5.5)", async () => {
    // Launched by a tap, but the payload omitted data.deepLink. This is
    // distinct from a normal launch (coldStart === null) and must route to
    // Home, not no-op.
    const notifications = new StubNotifications();
    notifications.coldStart = { id: "cold-2", deepLink: null };
    renderHook(() => useNotificationDeepLink(true), {
      wrapper: wrapperFor(notifications),
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(app)/(tabs)"));
  });

  it("routes a background/foreground tap to its deep link", async () => {
    const notifications = new StubNotifications();
    renderHook(() => useNotificationDeepLink(true), {
      wrapper: wrapperFor(notifications),
    });
    await waitFor(() =>
      expect(notifications.responseListeners).toHaveLength(1),
    );
    act(() =>
      notifications.emitResponse({
        id: "tap-1",
        deepLink: "/(app)/notifications",
      }),
    );
    expect(mockPush).toHaveBeenCalledWith("/(app)/notifications");
  });

  it("falls back to Home when a tapped notification has no deep link", async () => {
    const notifications = new StubNotifications();
    renderHook(() => useNotificationDeepLink(true), {
      wrapper: wrapperFor(notifications),
    });
    await waitFor(() =>
      expect(notifications.responseListeners).toHaveLength(1),
    );
    act(() => notifications.emitResponse({ id: "tap-2", deepLink: null }));
    expect(mockPush).toHaveBeenCalledWith("/(app)/(tabs)");
  });

  it("dispatches a cold-start tap only ONCE even if the listener re-fires it", async () => {
    // expo can surface the launching tap via BOTH the cold-start read and
    // the mounted response listener — the id-keyed dedup must collapse them
    // into a single navigation.
    const notifications = new StubNotifications();
    notifications.coldStart = {
      id: "dupe-1",
      deepLink: "/(app)/notifications",
    };

    renderHook(() => useNotificationDeepLink(true), {
      wrapper: wrapperFor(notifications),
    });
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/(app)/notifications"),
    );
    // The listener re-delivers the SAME launching notification (same id).
    act(() =>
      notifications.emitResponse({
        id: "dupe-1",
        deepLink: "/(app)/notifications",
      }),
    );
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when disabled", async () => {
    const notifications = new StubNotifications();
    notifications.coldStart = { id: "cold-1", deepLink: "/progress" };
    renderHook(() => useNotificationDeepLink(false), {
      wrapper: wrapperFor(notifications),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(notifications.responseListeners).toHaveLength(0);
  });
});
