/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { register: vi.fn(), deleteForUserAndToken: vi.fn() };

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "test-user-id",
      email: "test@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));

vi.mock("../../../repositories/userDeviceRepository", () => ({
  UserDeviceRepository: vi.fn().mockImplementation(function () {
    return mocks;
  }),
}));

const VALID_BODY = JSON.stringify({
  deviceToken: "ExponentPushToken[abc123]",
  platform: "ios",
  deviceInfo: { deviceName: "iPhone 15", osVersion: "iOS 18.1" },
});

describe("DevicesRegisterHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.register.mockResolvedValue({
      id: "device-1",
      userId: "test-user-id",
      deviceToken: "ExponentPushToken[abc123]",
      platform: "ios",
      deviceInfo: { deviceName: "iPhone 15", osVersion: "iOS 18.1" },
      isActive: true,
    });
  });

  it("requires authentication", async () => {
    const { devicesRegisterHandler } =
      await import("../devicesRegisterHandler");
    const response = await devicesRegisterHandler.handle(
      new Request("http://localhost/devices/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: VALID_BODY,
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 200 with { data: { id, registered: true } } on success", async () => {
    const { devicesRegisterHandler } =
      await import("../devicesRegisterHandler");
    const response = await devicesRegisterHandler.handle(
      new Request("http://localhost/devices/register", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: VALID_BODY,
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data).toEqual({ data: { id: "device-1", registered: true } });
  });

  it("forwards JWT userId to the repository (not body)", async () => {
    const { devicesRegisterHandler } =
      await import("../devicesRegisterHandler");
    await devicesRegisterHandler.handle(
      new Request("http://localhost/devices/register", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // Attempt to spoof a different userId via the body
          // (should be ignored — repo only sees JWT sub).
          userId: "attacker-id",
          deviceToken: "ExponentPushToken[xyz]",
          platform: "android",
        }),
      }),
    );
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledWith("test-user-id", {
      deviceToken: "ExponentPushToken[xyz]",
      platform: "android",
      deviceInfo: undefined,
    });
  });

  it("trims trailing whitespace from deviceToken before upsert", async () => {
    const { devicesRegisterHandler } =
      await import("../devicesRegisterHandler");
    await devicesRegisterHandler.handle(
      new Request("http://localhost/devices/register", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceToken: "  ExponentPushToken[abc]\n",
          platform: "ios",
        }),
      }),
    );
    const callArgs = mocks.register.mock.calls[0][1];
    expect(callArgs.deviceToken).toBe("ExponentPushToken[abc]");
  });

  it("returns 400 when deviceToken is whitespace-only", async () => {
    const { devicesRegisterHandler } =
      await import("../devicesRegisterHandler");
    const response = await devicesRegisterHandler.handle(
      new Request("http://localhost/devices/register", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceToken: "   ",
          platform: "ios",
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it.each([
    [
      "a raw APNs token (iOS 1.2.0 token listener)",
      "a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      "ios",
    ],
    [
      "a raw FCM registration token (Android)",
      "dGVzdC1mY20tdG9rZW4:APA91bH-example_FCM-registration-token",
      "android",
    ],
  ])(
    "PER-149: accepts %s with 200 but does not store it",
    async (_label, deviceToken, platform) => {
      const { devicesRegisterHandler } =
        await import("../devicesRegisterHandler");
      const response = await devicesRegisterHandler.handle(
        new Request("http://localhost/devices/register", {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deviceToken, platform }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: { id: null, registered: false },
      });
      expect(mocks.register).not.toHaveBeenCalled();
      expect(mocks.deleteForUserAndToken).toHaveBeenCalledWith(
        "test-user-id",
        deviceToken,
      );
    },
  );

  it("PER-149: a raw-token register deletes the caller's existing raw row, not another user's", async () => {
    // Rows the old Lambda wrote in the deploy window (after the clean-up
    // migration ran) must go the next time that phone registers.
    const RAW =
      "a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    let rows = [
      { userId: "test-user-id", deviceToken: RAW },
      { userId: "other-user-id", deviceToken: RAW },
      { userId: "test-user-id", deviceToken: "ExponentPushToken[keep]" },
    ];
    mocks.deleteForUserAndToken.mockImplementation(
      async (userId: string, token: string) => {
        rows = rows.filter(
          (r) => !(r.userId === userId && r.deviceToken === token),
        );
      },
    );
    const { devicesRegisterHandler } =
      await import("../devicesRegisterHandler");
    const response = await devicesRegisterHandler.handle(
      new Request("http://localhost/devices/register", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deviceToken: ` ${RAW}\n`, platform: "ios" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { id: null, registered: false },
    });
    expect(rows).toEqual([
      { userId: "other-user-id", deviceToken: RAW },
      { userId: "test-user-id", deviceToken: "ExponentPushToken[keep]" },
    ]);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("PER-149: still answers 200 when the raw-row clean-up fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.deleteForUserAndToken.mockRejectedValueOnce(new Error("db down"));
    const { devicesRegisterHandler } =
      await import("../devicesRegisterHandler");
    const response = await devicesRegisterHandler.handle(
      new Request("http://localhost/devices/register", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceToken: "raw-fcm-token",
          platform: "android",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { id: null, registered: false },
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each([
    "ExponentPushToken[abc123]",
    "ExpoPushToken[abc123]",
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  ])("PER-149: still stores Expo push token %s", async (deviceToken) => {
    const { devicesRegisterHandler } =
      await import("../devicesRegisterHandler");
    const response = await devicesRegisterHandler.handle(
      new Request("http://localhost/devices/register", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deviceToken, platform: "android" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledWith("test-user-id", {
      deviceToken,
      platform: "android",
      deviceInfo: undefined,
    });
    expect(mocks.deleteForUserAndToken).not.toHaveBeenCalled();
  });

  it("rejects invalid platform via the schema validator", async () => {
    const { devicesRegisterHandler } =
      await import("../devicesRegisterHandler");
    const response = await devicesRegisterHandler.handle(
      new Request("http://localhost/devices/register", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceToken: "ExponentPushToken[abc]",
          platform: "blackberry",
        }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("rejects missing deviceToken via the schema validator", async () => {
    const { devicesRegisterHandler } =
      await import("../devicesRegisterHandler");
    const response = await devicesRegisterHandler.handle(
      new Request("http://localhost/devices/register", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ platform: "ios" }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
