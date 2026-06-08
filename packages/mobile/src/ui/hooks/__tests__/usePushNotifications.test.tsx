import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Platform } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  LocalNotification,
  NotificationError,
  NotificationsPort,
} from "@/domain/ports/notifications.port";
import { fail, ok, type Result } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { usePushNotifications } from "@/ui/hooks/usePushNotifications";

class StubPushNotifications implements NotificationsPort {
  status: "granted" | "denied" | "not_determined" = "granted";
  requestResult: "granted" | "denied" = "granted";
  token = "device-token-abc";
  tokenFails = false;
  requestCalls = 0;
  tokenListeners: ((t: string) => void)[] = [];
  receivedListeners: (() => void)[] = [];

  async requestPermissions(): Promise<
    Result<"granted" | "denied", NotificationError>
  > {
    this.requestCalls += 1;
    return ok(this.requestResult);
  }
  statusThrows = false;
  async getPermissionStatus() {
    if (this.statusThrows) throw new Error("permission read blew up");
    return this.status;
  }
  async getDevicePushToken(): Promise<Result<string, NotificationError>> {
    return this.tokenFails
      ? fail({ kind: "notification", code: "token_failed", message: "x" })
      : ok(this.token);
  }
  async scheduleLocalNotification(_n: LocalNotification) {
    return "id";
  }
  async cancelLocalNotification() {}
  addPushTokenListener(listener: (t: string) => void) {
    this.tokenListeners.push(listener);
    return () => {
      this.tokenListeners = this.tokenListeners.filter((l) => l !== listener);
    };
  }
  addNotificationReceivedListener(listener: () => void) {
    this.receivedListeners.push(listener);
    return () => {
      this.receivedListeners = this.receivedListeners.filter(
        (l) => l !== listener,
      );
    };
  }
  emitTokenRotation(t = "rotated-token") {
    this.tokenListeners.forEach((l) => l(t));
  }
  emitReceived() {
    this.receivedListeners.forEach((l) => l());
  }
  addNotificationResponseListener() {
    return () => {};
  }
  async getLastNotificationResponse(): Promise<null> {
    return null;
  }
}

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  notifications: NotificationsPort,
  session: AuthSession | null,
): Adapters {
  const auth = {
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    resetPassword: jest.fn(),
    refreshSession: jest.fn(),
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

const SESSION: AuthSession = {
  accessToken: "t",
  refreshToken: "r",
  userId: "user-1",
  email: "u@example.com",
  expiresAt: Date.now() + 60_000,
};

function wrapperFor(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("usePushNotifications", () => {
  it("registers the device token after auth resolves (permission granted)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    const adapters = makeAdapters(api, storage, notifications, SESSION);

    // No explicit arg → exercises the `enabled = true` default.
    const { rerender } = renderHook(() => usePushNotifications(), {
      wrapper: wrapperFor(adapters),
    });

    await waitFor(() => expect(api.registeredDevices).toHaveLength(1));
    expect(api.registeredDevices[0]).toEqual({
      token: "device-token-abc",
      platform: "ios",
    });

    // A re-render for the same signed-in user must NOT re-register
    // (the registeredForRef guard).
    rerender(undefined);
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.registeredDevices).toHaveLength(1);
  });

  it("registers with platform 'android' on Android", async () => {
    const original = Platform.OS;
    Platform.OS = "android";
    try {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const notifications = new StubPushNotifications();
      const adapters = makeAdapters(api, storage, notifications, SESSION);

      renderHook(() => usePushNotifications(true), {
        wrapper: wrapperFor(adapters),
      });

      await waitFor(() => expect(api.registeredDevices).toHaveLength(1));
      expect(api.registeredDevices[0].platform).toBe("android");
    } finally {
      Platform.OS = original;
    }
  });

  it("registers nothing when permission is denied", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    notifications.status = "denied";
    const adapters = makeAdapters(api, storage, notifications, SESSION);

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });

    // give the registration effect a tick to run
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.registeredDevices).toHaveLength(0);
  });

  it("prompts when permission is undetermined, then registers if granted", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    notifications.status = "not_determined";
    notifications.requestResult = "granted";
    const adapters = makeAdapters(api, storage, notifications, SESSION);

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });

    await waitFor(() => expect(api.registeredDevices).toHaveLength(1));
    expect(notifications.requestCalls).toBe(1);
  });

  it("registers nothing when an undetermined prompt is denied", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    notifications.status = "not_determined";
    notifications.requestResult = "denied";
    const adapters = makeAdapters(api, storage, notifications, SESSION);

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(notifications.requestCalls).toBe(1);
    expect(api.registeredDevices).toHaveLength(0);
  });

  it("does not register when the token read fails", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    notifications.tokenFails = true;
    const adapters = makeAdapters(api, storage, notifications, SESSION);

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.registeredDevices).toHaveLength(0);
  });

  it("re-registers on Expo token rotation", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    const adapters = makeAdapters(api, storage, notifications, SESSION);

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });

    await waitFor(() => expect(api.registeredDevices).toHaveLength(1));
    await act(async () => {
      notifications.emitTokenRotation();
      await Promise.resolve();
    });
    await waitFor(() => expect(api.registeredDevices).toHaveLength(2));
  });

  it("refreshes the notifications cache on a foreground receive", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    api.notificationsUnreadCount = 3;
    const adapters = makeAdapters(api, storage, notifications, SESSION);

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });

    await waitFor(() =>
      expect(notifications.receivedListeners).toHaveLength(1),
    );
    await act(async () => {
      notifications.emitReceived();
      await Promise.resolve();
    });
    // refreshNotifications + refreshUnreadCount both hit the API
    await waitFor(() =>
      expect(api.getNotificationsCalls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("is a no-op when disabled", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    const adapters = makeAdapters(api, storage, notifications, SESSION);

    renderHook(() => usePushNotifications(false), {
      wrapper: wrapperFor(adapters),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.registeredDevices).toHaveLength(0);
    expect(notifications.tokenListeners).toHaveLength(0);
    expect(notifications.receivedListeners).toHaveLength(0);
  });

  it("logs the failure detail (with code) and never throws on registerDevice err", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    api.shouldFail = true; // registerDevice → Result.err {code:"server", message:"Test error"}
    const adapters = makeAdapters(api, storage, notifications, SESSION);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "device registration failed (server): Test error",
        ),
      ),
    );
    expect(api.registeredDevices).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("does NOT re-POST or re-log when the same failing token rotates repeatedly (no storm)", async () => {
    // The device-reported bug: Expo re-emits the same token on every
    // rotation event; without value-dedup a rejecting backend would be
    // re-POSTed + re-logged on each one. Mount attempts "device-token-abc"
    // (fails, 1 warn); repeated same-token rotations must be no-ops.
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications(); // token "device-token-abc"
    api.shouldFail = true;
    const adapters = makeAdapters(api, storage, notifications, SESSION);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });
    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1));

    await act(async () => {
      notifications.emitTokenRotation("device-token-abc");
      notifications.emitTokenRotation("device-token-abc");
      notifications.emitTokenRotation("device-token-abc");
      await Promise.resolve();
    });

    expect(warnSpy).toHaveBeenCalledTimes(1); // still just the one attempt
    expect(api.registeredDevices).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("retries on a genuinely new token after a failure", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    api.shouldFail = true;
    const adapters = makeAdapters(api, storage, notifications, SESSION);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });
    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1));

    // A genuinely NEW token (different value) is a fresh attempt → succeeds.
    api.shouldFail = false;
    await act(async () => {
      notifications.emitTokenRotation("a-new-token");
      await Promise.resolve();
    });
    await waitFor(() => expect(api.registeredDevices).toHaveLength(1));
    expect(api.registeredDevices[0].token).toBe("a-new-token");
    warnSpy.mockRestore();
  });

  it("dedupes a repeated same-token rotation after a successful register", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications(); // token "device-token-abc"
    const adapters = makeAdapters(api, storage, notifications, SESSION);

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });
    await waitFor(() => expect(api.registeredDevices).toHaveLength(1));

    await act(async () => {
      notifications.emitTokenRotation("device-token-abc"); // same as mount
      notifications.emitTokenRotation("device-token-abc");
      await Promise.resolve();
    });
    expect(api.registeredDevices).toHaveLength(1); // no duplicate POST
  });

  it("caught + logged when the permission read throws (unexpected, non-fatal)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    notifications.statusThrows = true; // register() rejects before any POST
    const adapters = makeAdapters(api, storage, notifications, SESSION);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        "[push] device registration failed:",
        expect.any(Error),
      ),
    );
    expect(api.registeredDevices).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("does not register until a user is signed in", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const notifications = new StubPushNotifications();
    const adapters = makeAdapters(api, storage, notifications, null);

    renderHook(() => usePushNotifications(true), {
      wrapper: wrapperFor(adapters),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.registeredDevices).toHaveLength(0);
  });
});
