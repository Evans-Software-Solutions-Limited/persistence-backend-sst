import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { ExpoNotificationsAdapter } from "../expo-notifications.adapter";
import { runNativePermissionRequest } from "@/lib/nativePermissionQueue";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(async () => ({
    data: "ExponentPushToken[stub]",
    type: "expo",
  })),
  scheduleNotificationAsync: jest.fn(async () => "stub-notif-id"),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  setBadgeCountAsync: jest.fn(async () => true),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));
let mockProjectId: unknown = "project-id";
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { eas: { projectId: mockProjectId } } };
    },
  },
}));

const adapter = new ExpoNotificationsAdapter();
const permission = (status: string) =>
  ({ status }) as Notifications.NotificationPermissionsStatus;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockProjectId = "project-id";
  Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
  AppState.currentState = "active";
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockResolvedValue(permission("undetermined"));
  jest
    .mocked(Notifications.requestPermissionsAsync)
    .mockResolvedValue(permission("granted"));
});

afterEach(() => {
  jest.useRealTimers();
});

it("waits behind another permission request and rechecks notification permission", async () => {
  let finish!: () => void;
  const other = runNativePermissionRequest(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const result = adapter.requestPermissions();
  await jest.advanceTimersByTimeAsync(1000);
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  finish();
  await other;
  await jest.advanceTimersByTimeAsync(300);
  await expect(result).resolves.toEqual({ ok: true, value: "granted" });
  expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
});

it.each(["granted", "denied"])(
  "does not ask again if permission is already %s",
  async (status) => {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockResolvedValue(permission(status));
    const result = adapter.requestPermissions();
    await jest.advanceTimersByTimeAsync(300);
    await expect(result).resolves.toEqual({ ok: true, value: status });
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  },
);

it("maps a refused native request to denied", async () => {
  jest
    .mocked(Notifications.requestPermissionsAsync)
    .mockResolvedValue(permission("denied"));
  const result = adapter.requestPermissions();
  await jest.advanceTimersByTimeAsync(300);
  await expect(result).resolves.toEqual({ ok: true, value: "denied" });
});

it("deduplicates competing notification callers using the fresh status", async () => {
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockResolvedValueOnce(permission("undetermined"))
    .mockResolvedValueOnce(permission("granted"));
  const first = adapter.requestPermissions();
  const second = adapter.requestPermissions();
  await jest.advanceTimersByTimeAsync(600);
  await expect(first).resolves.toEqual({ ok: true, value: "granted" });
  await expect(second).resolves.toEqual({ ok: true, value: "granted" });
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
});

it.each([new Error("native failure"), "native failure"])(
  "maps native errors through the port result",
  async (error) => {
    jest
      .mocked(Notifications.requestPermissionsAsync)
      .mockRejectedValueOnce(error);
    const result = adapter.requestPermissions();
    await jest.advanceTimersByTimeAsync(300);
    await expect(result).resolves.toEqual({
      ok: false,
      error: {
        kind: "notification",
        code: "permission_denied",
        message:
          error instanceof Error ? error.message : "Permission request failed",
      },
    });
  },
);

it.each([
  ["granted", "granted"],
  ["denied", "denied"],
  ["undetermined", "not_determined"],
])("reads %s permission as %s", async (status, expected) => {
  jest
    .mocked(Notifications.getPermissionsAsync)
    .mockResolvedValue(permission(status));
  await expect(adapter.getPermissionStatus()).resolves.toBe(expected);
});

it("gets the Expo push token using the configured project", async () => {
  await expect(adapter.getDevicePushToken()).resolves.toEqual({
    ok: true,
    value: "ExponentPushToken[stub]",
  });
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
    projectId: "project-id",
  });
});

it.each([new Error("token failure"), "token failure"])(
  "maps token errors",
  async (error) => {
    jest
      .mocked(Notifications.getExpoPushTokenAsync)
      .mockRejectedValueOnce(error);
    await expect(adapter.getDevicePushToken()).resolves.toEqual({
      ok: false,
      error: {
        kind: "notification",
        code: "token_failed",
        message:
          error instanceof Error
            ? error.message
            : "Failed to get Expo push token",
      },
    });
  },
);

it("normalizes non-string push tokens", async () => {
  jest.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValueOnce({
    data: 123,
    type: "expo",
  } as unknown as Notifications.ExpoPushToken);
  await expect(adapter.getDevicePushToken()).resolves.toEqual({
    ok: true,
    value: "123",
  });
});

it.each([undefined, 0, -1, 5])(
  "schedules local notifications with delay %s",
  async (triggerSeconds) => {
    await expect(
      adapter.scheduleLocalNotification({
        title: "Rest",
        body: "Done",
        triggerSeconds,
        data: { deepLink: "/session" },
      }),
    ).resolves.toBe("stub-notif-id");
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: "Rest", body: "Done", data: { deepLink: "/session" } },
      trigger:
        triggerSeconds && triggerSeconds > 0
          ? { type: "timeInterval", seconds: triggerSeconds, repeats: false }
          : null,
    });
  },
);

it("cancels scheduled notifications", async () => {
  await adapter.cancelLocalNotification("rest-id");
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
    "rest-id",
  );
});

it("omits malformed project IDs", async () => {
  mockProjectId = 123;
  await adapter.getDevicePushToken();
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith(undefined);
});
it.each([-5, 3])(
  "clamps badge count %s to a nonnegative value",
  async (count) => {
    await adapter.setBadgeCount(count);
    expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(
      Math.max(0, count),
    );
  },
);
it.each(["token", 123])(
  "normalizes rotated tokens and unsubscribes",
  (data) => {
    const listener = jest.fn();
    const unsubscribe = adapter.addPushTokenListener(listener);
    const [[callback]] = jest.mocked(Notifications.addPushTokenListener).mock
      .calls;
    callback({ data, type: "ios" } as Notifications.DevicePushToken);
    expect(listener).toHaveBeenCalledWith(String(data));
    unsubscribe();
    expect(
      jest.mocked(Notifications.addPushTokenListener).mock.results[0].value
        .remove,
    ).toHaveBeenCalledTimes(1);
  },
);
it("forwards received notifications and unsubscribes", () => {
  const listener = jest.fn();
  const unsubscribe = adapter.addNotificationReceivedListener(listener);
  const [[callback]] = jest.mocked(
    Notifications.addNotificationReceivedListener,
  ).mock.calls;
  callback({} as Notifications.Notification);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  expect(
    jest.mocked(Notifications.addNotificationReceivedListener).mock.results[0]
      .value.remove,
  ).toHaveBeenCalledTimes(1);
});
function response(data?: Record<string, unknown>) {
  return {
    notification: {
      request: { identifier: "notification-id", content: { data } },
    },
  } as Notifications.NotificationResponse;
}
it.each([
  [{ deepLink: "/session" }, "/session"],
  [{ deeplink: "/legacy" }, "/legacy"],
  [{ deepLink: 123 }, null],
  [undefined, null],
] as const)(
  "maps a notification response's deep link and unsubscribes",
  (data, expected) => {
    const listener = jest.fn();
    const unsubscribe = adapter.addNotificationResponseListener(listener);
    const [[callback]] = jest.mocked(
      Notifications.addNotificationResponseReceivedListener,
    ).mock.calls;
    callback(response(data));
    expect(listener).toHaveBeenCalledWith({
      id: "notification-id",
      deepLink: expected,
    });
    unsubscribe();
    expect(
      jest.mocked(Notifications.addNotificationResponseReceivedListener).mock
        .results[0].value.remove,
    ).toHaveBeenCalledTimes(1);
  },
);
it("returns null when no notification launched the app", async () => {
  await expect(adapter.getLastNotificationResponse()).resolves.toBeNull();
});
it("maps the notification that launched the app", async () => {
  jest
    .mocked(Notifications.getLastNotificationResponseAsync)
    .mockResolvedValueOnce(response({ deepLink: "/session" }));
  await expect(adapter.getLastNotificationResponse()).resolves.toEqual({
    id: "notification-id",
    deepLink: "/session",
  });
});
