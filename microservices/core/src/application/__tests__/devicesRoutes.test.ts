/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { register: vi.fn(), deactivateToken: vi.fn() };

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) =>
    authHeader?.startsWith("Bearer ") ? { sub: "test-user-id" } : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user),
}));

vi.mock("../repositories/userDeviceRepository", () => ({
  UserDeviceRepository: vi.fn().mockImplementation(() => mocks),
}));

function post(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("devicesRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.register.mockResolvedValue({ id: "device-1" });
    mocks.deactivateToken.mockResolvedValue(undefined);
  });

  it("mounts both /devices/register and /devices/unregister", async () => {
    const { devicesRoutes } = await import("../devicesRoutes");

    const registered = await devicesRoutes.handle(
      post("/devices/register", {
        deviceToken: "ExponentPushToken[abc]",
        platform: "ios",
      }),
    );
    expect(registered.status).toBe(200);
    expect(mocks.register).toHaveBeenCalledTimes(1);

    const unregistered = await devicesRoutes.handle(
      post("/devices/unregister", { deviceToken: "ExponentPushToken[abc]" }),
    );
    expect(unregistered.status).toBe(200);
    expect(mocks.deactivateToken).toHaveBeenCalledWith(
      "test-user-id",
      "ExponentPushToken[abc]",
    );
  });
});
