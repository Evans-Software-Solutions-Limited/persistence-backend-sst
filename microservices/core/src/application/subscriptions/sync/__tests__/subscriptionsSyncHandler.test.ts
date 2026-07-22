/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const subscriptionRepositoryMocks = {
  findForUser: vi.fn(),
};
const syncRevenueCatCustomerMock = vi.fn(async () => undefined);

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "user-1",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "user-1" }),
}));

vi.mock("../../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi
    .fn()
    .mockImplementation(() => subscriptionRepositoryMocks),
}));

vi.mock("../../../revenuecat/revenueCatSync", () => ({
  syncRevenueCatCustomer: syncRevenueCatCustomerMock,
}));

const fakeSub = {
  subscriptionId: "us_uuid",
  tierName: "premium",
  paymentStatus: "active",
  billingCycle: "monthly",
  startsAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z",
  cancelledAt: null,
  isTrainerTier: false,
};

function post(withAuth = true) {
  return new Request("http://localhost/subscriptions/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(withAuth ? { authorization: "Bearer token" } : {}),
    },
  });
}

describe("subscriptionsSyncHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncRevenueCatCustomerMock.mockResolvedValue(undefined);
    subscriptionRepositoryMocks.findForUser.mockResolvedValue(fakeSub);
  });

  it("requires auth", async () => {
    const { subscriptionsSyncHandler } =
      await import("../subscriptionsSyncHandler");
    const res = await subscriptionsSyncHandler.handle(post(false));
    expect(res.status).toBe(401);
    expect(syncRevenueCatCustomerMock).not.toHaveBeenCalled();
  });

  it("reconciles the caller's own RC customer, then returns the refreshed subscription", async () => {
    const { subscriptionsSyncHandler } =
      await import("../subscriptionsSyncHandler");
    const res = await subscriptionsSyncHandler.handle(post());
    expect(res.status).toBe(200);
    // Synced against the JWT subject (== RevenueCat app_user_id) — never a
    // client-supplied id.
    expect(syncRevenueCatCustomerMock).toHaveBeenCalledWith("user-1");
    expect(subscriptionRepositoryMocks.findForUser).toHaveBeenCalledWith(
      "user-1",
    );
    expect(((await res.json()) as any).data.tierName).toBe("premium");
  });

  it("502s and does NOT read the DB when the RevenueCat reconcile fails", async () => {
    syncRevenueCatCustomerMock.mockRejectedValueOnce(new Error("RC 503"));
    const { subscriptionsSyncHandler } =
      await import("../subscriptionsSyncHandler");
    const res = await subscriptionsSyncHandler.handle(post());
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).error).toBe("subscription_sync_failed");
    expect(subscriptionRepositoryMocks.findForUser).not.toHaveBeenCalled();
  });

  it("500s when findForUser throws (missing catalog row)", async () => {
    subscriptionRepositoryMocks.findForUser.mockRejectedValueOnce(
      new Error("no free tier"),
    );
    const { subscriptionsSyncHandler } =
      await import("../subscriptionsSyncHandler");
    const res = await subscriptionsSyncHandler.handle(post());
    expect(res.status).toBe(500);
  });

  it("404s when the profile row is missing", async () => {
    subscriptionRepositoryMocks.findForUser.mockResolvedValueOnce(null);
    const { subscriptionsSyncHandler } =
      await import("../subscriptionsSyncHandler");
    const res = await subscriptionsSyncHandler.handle(post());
    expect(res.status).toBe(404);
  });
});
