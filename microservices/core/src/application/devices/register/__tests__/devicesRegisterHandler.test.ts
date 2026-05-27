/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { register: vi.fn() };

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
  UserDeviceRepository: vi.fn().mockImplementation(() => mocks),
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
