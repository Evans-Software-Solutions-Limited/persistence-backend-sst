/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { deactivateToken: vi.fn() };

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

function post(body: unknown, authorized = true) {
  return new Request("http://localhost/devices/unregister", {
    method: "POST",
    headers: {
      ...(authorized ? { authorization: "Bearer token" } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("DevicesUnregisterHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deactivateToken.mockResolvedValue(undefined);
  });

  it("requires authentication", async () => {
    const { devicesUnregisterHandler } =
      await import("../devicesUnregisterHandler");
    const response = await devicesUnregisterHandler.handle(
      post({ deviceToken: "ExponentPushToken[abc]" }, false),
    );
    expect(response.status).toBe(401);
    expect(mocks.deactivateToken).not.toHaveBeenCalled();
  });

  it("deactivates the token for the JWT user, ignoring a body userId", async () => {
    const { devicesUnregisterHandler } =
      await import("../devicesUnregisterHandler");
    const response = await devicesUnregisterHandler.handle(
      post({ userId: "attacker-id", deviceToken: " ExponentPushToken[abc]\n" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { unregistered: true } });
    expect(mocks.deactivateToken).toHaveBeenCalledTimes(1);
    expect(mocks.deactivateToken).toHaveBeenCalledWith(
      "test-user-id",
      "ExponentPushToken[abc]",
    );
  });

  it("returns 400 when deviceToken is whitespace-only", async () => {
    const { devicesUnregisterHandler } =
      await import("../devicesUnregisterHandler");
    const response = await devicesUnregisterHandler.handle(
      post({ deviceToken: "   " }),
    );
    expect(response.status).toBe(400);
    expect(mocks.deactivateToken).not.toHaveBeenCalled();
  });

  it("rejects a missing deviceToken via the schema validator", async () => {
    const { devicesUnregisterHandler } =
      await import("../devicesUnregisterHandler");
    const response = await devicesUnregisterHandler.handle(post({}));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(mocks.deactivateToken).not.toHaveBeenCalled();
  });
});
