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
    const api = {
      unregisterDevice: jest.fn(() => new Promise<never>(() => {})),
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
    await jest.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
    expect(api.unregisterDevice).toHaveBeenCalledTimes(1);
  });
});
