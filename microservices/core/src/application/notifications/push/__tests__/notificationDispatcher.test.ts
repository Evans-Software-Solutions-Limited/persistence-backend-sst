/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NotificationDispatcher,
  toExpoMessage,
} from "../notificationDispatcher";
import { NOTIFICATION_PREFERENCES_PROFILE_MISSING } from "../../../repositories/profileRepository";
import type { AppNotification } from "../../../repositories/notificationRepository";

function makeRow(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n-1",
    userId: "user-1",
    type: "pt_request",
    title: "New training request",
    message: "Sam joined via your invite code",
    data: { deepLink: "persistencemobile://clients" },
    isRead: false,
    readAt: null,
    relatedEntityType: "pt_relationship",
    relatedEntityId: "rel-1",
    createdAt: "2026-06-29T10:00:00.000Z",
    ...overrides,
  };
}

interface Fakes {
  create: ReturnType<typeof vi.fn>;
  listActiveTokens: ReturnType<typeof vi.fn>;
  deactivateToken: ReturnType<typeof vi.fn>;
  getNotificationPreferences: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function makeDispatcher(fakes: Partial<Fakes> = {}): {
  dispatcher: NotificationDispatcher;
  f: Fakes;
} {
  const row = makeRow();
  const f: Fakes = {
    create: fakes.create ?? vi.fn(async () => row),
    listActiveTokens:
      fakes.listActiveTokens ??
      vi.fn(async () => [
        { deviceToken: "ExponentPushToken[a]", platform: "ios" },
      ]),
    deactivateToken: fakes.deactivateToken ?? vi.fn(async () => undefined),
    getNotificationPreferences:
      fakes.getNotificationPreferences ??
      vi.fn(async () => ({ pt_request: true })),
    send: fakes.send ?? vi.fn(async () => [{ status: "ok", id: "t-1" }]),
  };

  const dispatcher = new NotificationDispatcher(
    { create: f.create } as any,
    {
      listActiveTokens: f.listActiveTokens,
      deactivateToken: f.deactivateToken,
    } as any,
    { getNotificationPreferences: f.getNotificationPreferences } as any,
    f.send as any,
  );

  return { dispatcher, f };
}

describe("NotificationDispatcher.createAndDispatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists the in-app row then sends a push to active devices", async () => {
    const { dispatcher, f } = makeDispatcher();
    const row = await dispatcher.createAndDispatch("user-1", {
      type: "pt_request",
      title: "New training request",
    });

    expect(f.create).toHaveBeenCalledWith("user-1", {
      type: "pt_request",
      title: "New training request",
    });
    expect(f.send).toHaveBeenCalledTimes(1);
    const sent = f.send.mock.calls[0][0];
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ExponentPushToken[a]");
    expect(row.id).toBe("n-1");
  });

  it("persists the row but sends NO push when the type is muted", async () => {
    const { dispatcher, f } = makeDispatcher({
      getNotificationPreferences: vi.fn(async () => ({ pt_request: false })),
    });
    await dispatcher.createAndDispatch("user-1", {
      type: "pt_request",
      title: "x",
    });

    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("does not send when the profile is missing", async () => {
    const { dispatcher, f } = makeDispatcher({
      getNotificationPreferences: vi.fn(
        async () => NOTIFICATION_PREFERENCES_PROFILE_MISSING,
      ),
    });
    await dispatcher.createAndDispatch("user-1", {
      type: "pt_request",
      title: "x",
    });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("does not send when the user has no active devices", async () => {
    const { dispatcher, f } = makeDispatcher({
      listActiveTokens: vi.fn(async () => []),
    });
    await dispatcher.createAndDispatch("user-1", {
      type: "pt_request",
      title: "x",
    });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("sends when the pref key is absent (opt-out default)", async () => {
    const { dispatcher, f } = makeDispatcher({
      getNotificationPreferences: vi.fn(async () => ({})),
    });
    await dispatcher.createAndDispatch("user-1", {
      type: "pt_request",
      title: "x",
    });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("never throws and still returns the row when the push send fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { dispatcher, f } = makeDispatcher({
      send: vi.fn(async () => {
        throw new Error("expo down");
      }),
    });

    const row = await dispatcher.createAndDispatch("user-1", {
      type: "pt_request",
      title: "x",
    });

    expect(row.id).toBe("n-1");
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("deactivates a token whose ticket is DeviceNotRegistered", async () => {
    const { dispatcher, f } = makeDispatcher({
      listActiveTokens: vi.fn(async () => [
        { deviceToken: "ExponentPushToken[live]", platform: "ios" },
        { deviceToken: "ExponentPushToken[dead]", platform: "android" },
      ]),
      send: vi.fn(async () => [
        { status: "ok", id: "t-1" },
        { status: "error", details: { error: "DeviceNotRegistered" } },
      ]),
    });

    await dispatcher.createAndDispatch("user-1", {
      type: "pt_request",
      title: "x",
    });

    expect(f.deactivateToken).toHaveBeenCalledTimes(1);
    expect(f.deactivateToken).toHaveBeenCalledWith(
      "user-1",
      "ExponentPushToken[dead]",
    );
  });

  it("does not deactivate on a non-DeviceNotRegistered ticket error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { dispatcher, f } = makeDispatcher({
      send: vi.fn(async () => [
        { status: "error", details: { error: "MessageRateExceeded" } },
      ]),
    });

    await dispatcher.createAndDispatch("user-1", {
      type: "pt_request",
      title: "x",
    });

    expect(f.deactivateToken).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("logs an error ticket that carries no error code without deactivating", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { dispatcher, f } = makeDispatcher({
      send: vi.fn(async () => [{ status: "error" }]),
    });

    await dispatcher.createAndDispatch("user-1", {
      type: "pt_request",
      title: "x",
    });

    expect(f.deactivateToken).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("tolerates fewer tickets than devices (no deactivation, no throw)", async () => {
    const { dispatcher, f } = makeDispatcher({
      listActiveTokens: vi.fn(async () => [
        { deviceToken: "ExponentPushToken[a]", platform: "ios" },
        { deviceToken: "ExponentPushToken[b]", platform: "android" },
      ]),
      // Only one ticket comes back for two devices — index 1 is undefined.
      send: vi.fn(async () => [{ status: "ok", id: "t-1" }]),
    });

    await expect(
      dispatcher.createAndDispatch("user-1", {
        type: "pt_request",
        title: "x",
      }),
    ).resolves.toBeDefined();
    expect(f.deactivateToken).not.toHaveBeenCalled();
  });

  it("isolates a deactivation failure (does not reject)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { dispatcher } = makeDispatcher({
      send: vi.fn(async () => [
        { status: "error", details: { error: "DeviceNotRegistered" } },
      ]),
      deactivateToken: vi.fn(async () => {
        throw new Error("db down");
      }),
    });

    await expect(
      dispatcher.createAndDispatch("user-1", {
        type: "pt_request",
        title: "x",
      }),
    ).resolves.toBeDefined();
    warn.mockRestore();
  });

  it("constructs with production defaults when no deps are injected", () => {
    expect(() => new NotificationDispatcher()).not.toThrow();
  });
});

describe("toExpoMessage", () => {
  it("mirrors the legacy message shape and carries routing data", () => {
    const row = makeRow();
    const message = toExpoMessage(
      { deviceToken: "ExponentPushToken[a]", platform: "ios" },
      row,
    );

    expect(message).toMatchObject({
      to: "ExponentPushToken[a]",
      title: "New training request",
      body: "Sam joined via your invite code",
      sound: "default",
      priority: "high",
      channelId: "default",
    });
    expect(message.data).toMatchObject({
      notification_type: "pt_request",
      notification_id: "n-1",
      deepLink: "persistencemobile://clients",
    });
  });

  it("defaults a null message body to an empty string", () => {
    const row = makeRow({ message: null });
    const message = toExpoMessage(
      { deviceToken: "ExponentPushToken[a]", platform: "ios" },
      row,
    );
    expect(message.body).toBe("");
  });

  it("canonicalises lowercase deeplink to deepLink in the push data", () => {
    const row = makeRow({
      data: { deeplink: "persistencemobile://clients?clientId=c1" },
    });
    const message = toExpoMessage(
      { deviceToken: "ExponentPushToken[a]", platform: "ios" },
      row,
    );
    expect(message.data?.deepLink).toBe(
      "persistencemobile://clients?clientId=c1",
    );
    // The original lowercase key is also preserved (spread).
    expect(message.data?.deeplink).toBe(
      "persistencemobile://clients?clientId=c1",
    );
  });

  it("does not overwrite deepLink if already set (camelCase takes precedence)", () => {
    const row = makeRow({
      data: {
        deepLink: "persistencemobile://streaks",
        deeplink: "persistencemobile://old",
      },
    });
    const message = toExpoMessage(
      { deviceToken: "ExponentPushToken[a]", platform: "ios" },
      row,
    );
    expect(message.data?.deepLink).toBe("persistencemobile://streaks");
  });
});
