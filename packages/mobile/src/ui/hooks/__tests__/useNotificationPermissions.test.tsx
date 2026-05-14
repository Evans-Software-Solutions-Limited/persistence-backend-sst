/**
 * useNotificationPermissions tests — covers the install-time
 * permission-prompt flow added after Brad's M3 Phase 3b staging
 * review. The hook's job is to fire `requestPermissions()` exactly
 * once per install (AsyncStorage flag), and only when the user is
 * authenticated.
 */

import React from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AdapterProvider } from "../useAdapters";
import { useNotificationPermissions } from "../useNotificationPermissions";
import type { Adapters } from "@/shared/types";
import type {
  NotificationError,
  NotificationsPort,
} from "@/domain/ports/notifications.port";
import { ok, type Result } from "@/shared/errors";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const asyncStorageMock = AsyncStorage as unknown as {
  getItem: jest.Mock;
  setItem: jest.Mock;
};

class StubNotifications implements NotificationsPort {
  status: "granted" | "denied" | "not_determined" = "not_determined";
  requestResult: "granted" | "denied" = "granted";
  requestCalls = 0;

  async requestPermissions(): Promise<
    Result<"granted" | "denied", NotificationError>
  > {
    this.requestCalls += 1;
    return ok(this.requestResult);
  }
  async getPermissionStatus() {
    return this.status;
  }
  async getDevicePushToken(): Promise<Result<string, NotificationError>> {
    return ok("stub");
  }
  async scheduleLocalNotification() {
    return "stub";
  }
  async cancelLocalNotification() {
    return;
  }
}

function makeWrapper(notifications: NotificationsPort) {
  const adapters = {
    api: {},
    auth: {},
    storage: {},
    notifications,
    health: {},
    payments: {},
  } as unknown as Adapters;
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("useNotificationPermissions", () => {
  beforeEach(() => {
    asyncStorageMock.getItem.mockReset();
    asyncStorageMock.setItem.mockReset();
  });

  it("does not prompt when disabled (e.g. user not signed in yet)", async () => {
    asyncStorageMock.getItem.mockResolvedValue(null);
    const notifications = new StubNotifications();
    renderHook(() => useNotificationPermissions(false), {
      wrapper: makeWrapper(notifications),
    });

    // Give the effect a tick to run (it shouldn't).
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(asyncStorageMock.getItem).not.toHaveBeenCalled();
    expect(notifications.requestCalls).toBe(0);
  });

  it("prompts on first authenticated mount when status is `not_determined`", async () => {
    // Fresh install: AsyncStorage flag absent, OS status not_determined.
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue(undefined);
    const notifications = new StubNotifications();
    notifications.status = "not_determined";
    notifications.requestResult = "granted";

    renderHook(() => useNotificationPermissions(true), {
      wrapper: makeWrapper(notifications),
    });

    await waitFor(() => {
      expect(notifications.requestCalls).toBe(1);
    });
    // Flag stamped so subsequent mounts skip the prompt.
    await waitFor(() => {
      expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
        "notification_permission_requested",
        "true",
      );
    });
  });

  it("does NOT prompt again when the AsyncStorage flag is already set", async () => {
    asyncStorageMock.getItem.mockResolvedValue("true");
    const notifications = new StubNotifications();
    notifications.status = "not_determined";

    renderHook(() => useNotificationPermissions(true), {
      wrapper: makeWrapper(notifications),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(notifications.requestCalls).toBe(0);
    expect(asyncStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("stamps the flag without re-prompting when the OS already shows `granted`", async () => {
    // User granted notifications via Settings before we asked (e.g.
    // re-install with cached system permission). We don't show
    // another prompt — just stamp the flag so we don't loop.
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue(undefined);
    const notifications = new StubNotifications();
    notifications.status = "granted";

    renderHook(() => useNotificationPermissions(true), {
      wrapper: makeWrapper(notifications),
    });

    await waitFor(() => {
      expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
        "notification_permission_requested",
        "true",
      );
    });
    expect(notifications.requestCalls).toBe(0);
  });

  it("stamps the flag without re-prompting when the OS shows `denied`", async () => {
    // User previously denied (e.g. revoked via Settings between
    // installs). Don't auto-re-prompt — iOS would no-op the prompt
    // anyway since denial requires a trip to Settings. Stamp the
    // flag so the hook stops trying.
    asyncStorageMock.getItem.mockResolvedValue(null);
    asyncStorageMock.setItem.mockResolvedValue(undefined);
    const notifications = new StubNotifications();
    notifications.status = "denied";

    renderHook(() => useNotificationPermissions(true), {
      wrapper: makeWrapper(notifications),
    });

    await waitFor(() => {
      expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
        "notification_permission_requested",
        "true",
      );
    });
    expect(notifications.requestCalls).toBe(0);
  });

  it("does not double-prompt on re-render before AsyncStorage settles (in-memory ref guard)", async () => {
    // AsyncStorage.getItem deliberately slow to expose the race
    // where multiple renders fire the effect before the first
    // async lookup completes.
    let resolveGetItem: ((v: string | null) => void) | null = null;
    asyncStorageMock.getItem.mockImplementation(
      () => new Promise((r) => (resolveGetItem = r)),
    );
    asyncStorageMock.setItem.mockResolvedValue(undefined);
    const notifications = new StubNotifications();
    notifications.status = "not_determined";

    const { rerender } = renderHook(() => useNotificationPermissions(true), {
      wrapper: makeWrapper(notifications),
    });
    // Force a couple of re-renders while getItem is still pending.
    rerender(undefined as never);
    rerender(undefined as never);
    // Now let AsyncStorage resolve.
    if (resolveGetItem) (resolveGetItem as (v: string | null) => void)(null);

    await waitFor(() => {
      expect(notifications.requestCalls).toBe(1);
    });
    // ref guard prevented additional prompts despite the re-renders.
    expect(notifications.requestCalls).toBe(1);
  });

  it("swallows AsyncStorage failures silently (no throw, no infinite retry)", async () => {
    // AsyncStorage can fail under disk-pressure on Android. The
    // hook's catch falls through — rest-timer's own fallback
    // ensures the in-app countdown still works.
    asyncStorageMock.getItem.mockRejectedValue(new Error("disk full"));
    const notifications = new StubNotifications();
    notifications.status = "not_determined";

    expect(() => {
      renderHook(() => useNotificationPermissions(true), {
        wrapper: makeWrapper(notifications),
      });
    }).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 10));
    // Request still didn't fire because we couldn't read the flag.
    // That's the safe default — better to miss the prompt than to
    // re-prompt indefinitely.
    expect(notifications.requestCalls).toBe(0);
  });
});
