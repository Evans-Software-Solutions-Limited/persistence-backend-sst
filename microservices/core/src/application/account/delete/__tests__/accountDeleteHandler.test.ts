import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "user-id",
      email: "u@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "user-id" }),
}));

const {
  calls,
  purgeUserData,
  getSupabaseAdminConfig,
  deleteAuthUserWithRetry,
  findMostRecentForUser,
  stripeCancelMock,
} = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    purgeUserData: vi.fn(async () => void calls.push("purge")),
    getSupabaseAdminConfig: vi.fn(() => ({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
    })),
    deleteAuthUserWithRetry: vi.fn(async () => void calls.push("auth-delete")),
    findMostRecentForUser: vi.fn(
      async () =>
        null as {
          externalSubscriptionId: string;
          paymentStatus: string;
        } | null,
    ),
    stripeCancelMock: vi.fn(async () => ({})),
  };
});

vi.mock("../../accountRepository", () => ({
  AccountRepository: vi.fn(() => ({ purgeUserData })),
}));
vi.mock("../../supabaseAdminClient", () => ({
  getSupabaseAdminConfig,
  deleteAuthUserWithRetry,
}));
vi.mock("../../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi.fn(() => ({ findMostRecentForUser })),
}));
vi.mock("../../../stripe/stripeClient", () => ({
  getStripe: () => ({ subscriptions: { cancel: stripeCancelMock } }),
}));

import { accountDeleteHandler } from "../accountDeleteHandler";

const authed = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function del(headers: Record<string, string> = authed) {
  return new Request("http://localhost/account", {
    method: "DELETE",
    headers,
  });
}

describe("accountDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    getSupabaseAdminConfig.mockReturnValue({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
    });
    findMostRecentForUser.mockResolvedValue(null);
  });

  it("401s when unauthenticated", async () => {
    const res = await accountDeleteHandler.handle(
      del({ "Content-Type": "application/json" }),
    );
    expect(res.status).toBe(401);
    expect(purgeUserData).not.toHaveBeenCalled();
  });

  it("cancels Stripe sub, purges data, deletes auth user, returns 200", async () => {
    findMostRecentForUser.mockResolvedValue({
      externalSubscriptionId: "sub_abc",
      paymentStatus: "active",
    });
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { deleted: true } });
    expect(stripeCancelMock).toHaveBeenCalledWith("sub_abc");
    expect(purgeUserData).toHaveBeenCalledWith("user-id");
    expect(deleteAuthUserWithRetry).toHaveBeenCalledWith("user-id");
    expect(calls).toEqual(["purge", "auth-delete"]);
  });

  it("skips Stripe cancel for RevenueCat-managed (Apple IAP) subs", async () => {
    findMostRecentForUser.mockResolvedValue({
      externalSubscriptionId: "rc_user-id",
      paymentStatus: "active",
    });
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(stripeCancelMock).not.toHaveBeenCalled();
    expect(purgeUserData).toHaveBeenCalled();
  });

  it("skips Stripe cancel when sub is already cancelled", async () => {
    findMostRecentForUser.mockResolvedValue({
      externalSubscriptionId: "sub_abc",
      paymentStatus: "cancelled",
    });
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(stripeCancelMock).not.toHaveBeenCalled();
  });

  it("treats Stripe resource_missing as already cancelled (idempotent)", async () => {
    findMostRecentForUser.mockResolvedValue({
      externalSubscriptionId: "sub_abc",
      paymentStatus: "active",
    });
    const err = new Error("No such subscription") as Error & { code: string };
    err.code = "resource_missing";
    stripeCancelMock.mockRejectedValueOnce(err);
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(purgeUserData).toHaveBeenCalled();
  });

  it("502s and aborts when Stripe cancel genuinely fails (no purge)", async () => {
    findMostRecentForUser.mockResolvedValue({
      externalSubscriptionId: "sub_abc",
      paymentStatus: "active",
    });
    stripeCancelMock.mockRejectedValueOnce(new Error("Stripe down"));
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(502);
    expect(purgeUserData).not.toHaveBeenCalled();
  });

  it("fails fast (500) before any purge when service-role key is unconfigured", async () => {
    getSupabaseAdminConfig.mockImplementation(() => {
      throw new Error("Missing env");
    });
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Account deletion is not configured",
    });
    expect(purgeUserData).not.toHaveBeenCalled();
  });

  it("returns 200 even when auth-user delete fails (data already purged)", async () => {
    deleteAuthUserWithRetry.mockRejectedValueOnce(new Error("admin 503"));
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { deleted: true } });
    expect(purgeUserData).toHaveBeenCalledTimes(1);
  });

  it("500s when the data purge fails (nothing deleted)", async () => {
    purgeUserData.mockRejectedValueOnce(new Error("tx rolled back"));
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to delete account" });
  });
});
