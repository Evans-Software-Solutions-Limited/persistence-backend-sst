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
  softDelete,
  getSupabaseAdminConfig,
  findStripeSubscriptionIdsForUser,
  stripeCancelMock,
} = vi.hoisted(() => {
  const FIXED_PURGE_AFTER = new Date("2026-08-12T00:00:00.000Z");
  return {
    softDelete: vi.fn(async () => FIXED_PURGE_AFTER),
    getSupabaseAdminConfig: vi.fn(() => ({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
    })),
    findStripeSubscriptionIdsForUser: vi.fn(async (): Promise<string[]> => []),
    stripeCancelMock: vi.fn(async () => ({})),
  };
});

vi.mock("../../accountRepository", () => ({
  AccountRepository: vi.fn(() => ({ softDelete })),
}));
vi.mock("../../supabaseAdminClient", () => ({
  getSupabaseAdminConfig,
}));
vi.mock("../../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi.fn(() => ({ findStripeSubscriptionIdsForUser })),
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

describe("accountDeleteHandler (Cluster 2a soft-delete)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseAdminConfig.mockReturnValue({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
    });
    findStripeSubscriptionIdsForUser.mockResolvedValue([]);
    softDelete.mockResolvedValue(new Date("2026-08-12T00:00:00.000Z"));
  });

  it("401s when unauthenticated", async () => {
    const res = await accountDeleteHandler.handle(
      del({ "Content-Type": "application/json" }),
    );
    expect(res.status).toBe(401);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("cancels Stripe sub, soft-deletes (stamps deleted_at/purge_after), returns 200 with purgeAfter — does NOT purge data or delete the auth user", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["sub_abc"]);
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        softDeleted: true,
        purgeAfter: "2026-08-12T00:00:00.000Z",
      },
    });
    expect(stripeCancelMock).toHaveBeenCalledWith("sub_abc");
    expect(softDelete).toHaveBeenCalledWith("user-id");
  });

  it("cancels EVERY Stripe subscription the user has (not just the newest)", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["sub_a", "sub_b"]);
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(stripeCancelMock).toHaveBeenCalledWith("sub_a");
    expect(stripeCancelMock).toHaveBeenCalledWith("sub_b");
    expect(stripeCancelMock).toHaveBeenCalledTimes(2);
  });

  it("cancels only sub_ rows and skips rc_ in a mixed list", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue([
      "sub_a",
      "rc_user-id",
      "sub_b",
    ]);
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(stripeCancelMock).toHaveBeenCalledTimes(2);
    expect(stripeCancelMock).toHaveBeenCalledWith("sub_a");
    expect(stripeCancelMock).toHaveBeenCalledWith("sub_b");
    expect(stripeCancelMock).not.toHaveBeenCalledWith("rc_user-id");
  });

  it("aborts (502, no soft-delete) when a later sub in the loop genuinely fails", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["sub_a", "sub_b"]);
    stripeCancelMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("Stripe down"));
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(502);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("skips Stripe cancel for RevenueCat-managed (Apple IAP) subs", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["rc_user-id"]);
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(stripeCancelMock).not.toHaveBeenCalled();
    expect(softDelete).toHaveBeenCalled();
  });

  it("treats Stripe resource_missing as already cancelled (idempotent)", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["sub_abc"]);
    const err = new Error("No such subscription") as Error & { code: string };
    err.code = "resource_missing";
    stripeCancelMock.mockRejectedValueOnce(err);
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(softDelete).toHaveBeenCalled();
  });

  it("502s and aborts when Stripe cancel genuinely fails (no soft-delete)", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["sub_abc"]);
    stripeCancelMock.mockRejectedValueOnce(new Error("Stripe down"));
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(502);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("fails fast (500) before any Stripe/soft-delete work when service-role key is unconfigured", async () => {
    getSupabaseAdminConfig.mockImplementation(() => {
      throw new Error("Missing env");
    });
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Account deletion is not configured",
    });
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("re-request re-stamps the window (idempotent) — calling again just re-invokes softDelete", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue([]);
    const first = await accountDeleteHandler.handle(del());
    const second = await accountDeleteHandler.handle(del());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(softDelete).toHaveBeenCalledTimes(2);
  });

  it("500s when the soft-delete stamp fails", async () => {
    softDelete.mockRejectedValueOnce(new Error("db down"));
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to delete account" });
  });
});
