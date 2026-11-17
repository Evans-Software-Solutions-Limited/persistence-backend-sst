import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { unregisterDeviceCommand } from "@/application/notifications";
import type { NotificationsPort } from "@/domain/ports/notifications.port";
import { fail, ok } from "@/shared/errors";

type PushReads = Pick<
  NotificationsPort,
  "getPermissionStatus" | "getDevicePushToken"
>;

function notificationsWith(
  status: "granted" | "denied" | "not_determined",
  token: string | null = "ExponentPushToken[abc]",
): PushReads {
  return {
    getPermissionStatus: jest.fn(async () => status),
    getDevicePushToken: jest.fn(async () =>
      token === null
        ? fail({ kind: "notification", code: "token_failed", message: "x" })
        : ok(token),
    ),
  } as PushReads;
}

describe("unregisterDeviceCommand", () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  it("unregisters this device's push token when permission is granted", async () => {
    const api = new InMemoryApiAdapter();
    await unregisterDeviceCommand(api, notificationsWith("granted"));
    expect(api.unregisteredDevices).toEqual([
      { token: "ExponentPushToken[abc]" },
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each(["denied", "not_determined"] as const)(
    "does nothing (and never reads a token) when permission is %s",
    async (status) => {
      const api = new InMemoryApiAdapter();
      const notifications = notificationsWith(status);
      await unregisterDeviceCommand(api, notifications);
      expect(api.unregisteredDevices).toEqual([]);
      expect(notifications.getDevicePushToken).not.toHaveBeenCalled();
    },
  );

  it("does nothing when the token read fails", async () => {
    const api = new InMemoryApiAdapter();
    await unregisterDeviceCommand(api, notificationsWith("granted", null));
    expect(api.unregisteredDevices).toEqual([]);
  });

  it("logs, but resolves, when the API call fails", async () => {
    const api = new InMemoryApiAdapter();
    api.shouldFail = true;
    await expect(
      unregisterDeviceCommand(api, notificationsWith("granted")),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[push] device unregister failed (server)"),
    );
  });

  it("logs, but resolves, when a step throws", async () => {
    const api = new InMemoryApiAdapter();
    const notifications = notificationsWith("granted");
    (notifications.getPermissionStatus as jest.Mock).mockRejectedValue(
      new Error("boom"),
    );
    await expect(
      unregisterDeviceCommand(api, notifications),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[push] device unregister threw:",
      expect.any(Error),
    );
  });

  it("gives up after the timeout so an offline sign-out never hangs", async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const api = {
      unregisterDevice: jest.fn((_input: unknown, s?: AbortSignal) => {
        signal = s;
        return new Promise<never>(() => {});
      }),
    };
    let settled = false;
    const done = unregisterDeviceCommand(
      api,
      notificationsWith("granted"),
      3000,
    ).then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
    expect(api.unregisterDevice).toHaveBeenCalledTimes(1);
    // The request itself is aborted, not just abandoned: a late unregister
    // could otherwise switch off a fresh registration for the same account.
    expect(signal?.aborted).toBe(true);
  });

  it("passes a live (not aborted) signal on a call that completes in time", async () => {
    const api = new InMemoryApiAdapter();
    await unregisterDeviceCommand(api, notificationsWith("granted"));
    expect(api.lastUnregisterSignal).toBeInstanceOf(AbortSignal);
    expect(api.lastUnregisterSignal?.aborted).toBe(false);
  });

  it("never sends the unregister if the timeout fired during the token read", async () => {
    jest.useFakeTimers();
    let resolveToken: (v: { ok: true; value: string }) => void = () => {};
    const notifications = notificationsWith("granted");
    (notifications.getDevicePushToken as jest.Mock).mockImplementation(
      () => new Promise((r) => (resolveToken = r)),
    );
    const api = { unregisterDevice: jest.fn() };

    const done = unregisterDeviceCommand(api, notifications, 3000);
    await jest.advanceTimersByTimeAsync(3000);
    await done;
    resolveToken({ ok: true, value: "ExponentPushToken[abc]" });
    await jest.advanceTimersByTimeAsync(0);

    expect(api.unregisterDevice).not.toHaveBeenCalled();
  });

  it("does not log the failure of a request it aborted itself", async () => {
    jest.useFakeTimers();
    let settle: (v: unknown) => void = () => {};
    const api = {
      unregisterDevice: jest.fn(() => new Promise((r) => (settle = r))),
    };

    const done = unregisterDeviceCommand(
      api as never,
      notificationsWith("granted"),
      3000,
    );
    await jest.advanceTimersByTimeAsync(3000);
    await done;
    settle({
      ok: false,
      error: { kind: "api", code: "network", message: "aborted" },
    });
    await jest.advanceTimersByTimeAsync(0);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
