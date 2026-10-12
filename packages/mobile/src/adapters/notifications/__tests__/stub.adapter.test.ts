import { StubNotificationsAdapter } from "../stub.adapter";

describe("StubNotificationsAdapter", () => {
  const adapter = new StubNotificationsAdapter();
  const unavailable = {
    ok: false,
    error: {
      kind: "notification",
      code: "permission_denied",
      message: "Notifications not yet available",
    },
  };

  it("refuses permissions and tokens with the same unavailable error", async () => {
    await expect(adapter.requestPermissions()).resolves.toEqual(unavailable);
    await expect(adapter.getDevicePushToken()).resolves.toEqual(unavailable);
    await expect(adapter.getPermissionStatus()).resolves.toBe("not_determined");
    await expect(adapter.getLastNotificationResponse()).resolves.toBeNull();
  });

  it("treats scheduling, badges and listeners as no-ops", async () => {
    await expect(adapter.scheduleLocalNotification()).resolves.toBe("");
    await expect(adapter.cancelLocalNotification()).resolves.toBeUndefined();
    await expect(adapter.setBadgeCount()).resolves.toBeUndefined();
    for (const remove of [
      adapter.addPushTokenListener(),
      adapter.addNotificationReceivedListener(),
      adapter.addNotificationResponseListener(),
    ])
      expect(remove()).toBeUndefined();
  });
});
