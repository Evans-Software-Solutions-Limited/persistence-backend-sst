/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const subscriptionRepositoryMocks = {
  findForUser: vi.fn(),
};

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

const fakeMySubscription = {
  subscriptionId: "us_uuid",
  tierName: "premium",
  paymentStatus: "active",
  billingCycle: "monthly",
  startsAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z",
  cancelledAt: null,
  trialEndsAt: null,
  externalSubscriptionId: "sub_test",
  tierDisplayName: "Premium",
  tierDescription: "Unlimited",
  workoutLimit: null,
  aiAccess: true,
  aiWorkoutLimit: 6,
  gymBuddyAccess: true,
  trainerClientLimit: null,
  isTrainerTier: false,
  role: "user",
  hasUsedUserTrial: true,
  hasUsedTrainerTrial: false,
  isEligibleForUserTrial: false,
  isEligibleForTrainerTrial: true,
  scheduledChange: null,
};

async function getMe(withAuth = true) {
  const { subscriptionsMeHandler } = await import("../subscriptionsMeHandler");
  return subscriptionsMeHandler.handle(
    new Request("http://localhost/subscriptions/me", {
      method: "GET",
      headers: {
        ...(withAuth ? { authorization: "Bearer test-token" } : {}),
      },
    }),
  );
}

describe("subscriptionsMeHandler — GET /subscriptions/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    const res = await getMe(false);
    expect(res.status).toBe(401);
    expect(subscriptionRepositoryMocks.findForUser).not.toHaveBeenCalled();
  });

  it("returns 200 with the joined MySubscription shape on the authed happy path", async () => {
    subscriptionRepositoryMocks.findForUser.mockResolvedValueOnce(
      fakeMySubscription,
    );
    const res = await getMe();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ data: fakeMySubscription });
    expect(subscriptionRepositoryMocks.findForUser).toHaveBeenCalledWith(
      "user-1",
    );
  });

  it("returns 200 with the synthesised free shape when the user has no sub row", async () => {
    subscriptionRepositoryMocks.findForUser.mockResolvedValueOnce({
      ...fakeMySubscription,
      subscriptionId: null,
      tierName: "free",
      paymentStatus: "active",
      billingCycle: null,
      expiresAt: null,
      trialEndsAt: null,
      externalSubscriptionId: null,
      tierDisplayName: "Free",
      tierDescription: null,
      aiAccess: false,
      aiWorkoutLimit: 0,
      gymBuddyAccess: false,
      isTrainerTier: false,
      hasUsedUserTrial: false,
      isEligibleForUserTrial: true,
      scheduledChange: null,
    });
    const res = await getMe();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.subscriptionId).toBeNull();
    expect(body.data.tierName).toBe("free");
    expect(body.data.paymentStatus).toBe("active");
    expect(body.data.isEligibleForUserTrial).toBe(true);
  });

  it("returns 404 when the profile row is missing for the authed userId", async () => {
    subscriptionRepositoryMocks.findForUser.mockResolvedValueOnce(null);
    const res = await getMe();
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("profile not found"),
    });
  });

  it("returns 500 with a structured log when the repository throws (free-tier deploy misconfig)", async () => {
    subscriptionRepositoryMocks.findForUser.mockRejectedValueOnce(
      new Error("subscription_tiers.tier_name='free' row not found"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await getMe();
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("findForUser failed for user=user-1"),
    );
    errSpy.mockRestore();
  });

  it("returns 500 with a structured log for any other repo error", async () => {
    // Non-Error throw (string) — must still produce a structured log.
    subscriptionRepositoryMocks.findForUser.mockRejectedValueOnce(
      "neon timeout",
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await getMe();
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("neon timeout"),
    );
    errSpy.mockRestore();
  });

  it("surfaces a scheduled-change shape verbatim when present", async () => {
    subscriptionRepositoryMocks.findForUser.mockResolvedValueOnce({
      ...fakeMySubscription,
      scheduledChange: {
        nextTierName: "basic",
        nextDisplayName: "Basic",
        effectiveAt: "2026-03-01T00:00:00.000Z",
      },
    });
    const res = await getMe();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.scheduledChange).toEqual({
      nextTierName: "basic",
      nextDisplayName: "Basic",
      effectiveAt: "2026-03-01T00:00:00.000Z",
    });
  });
});
