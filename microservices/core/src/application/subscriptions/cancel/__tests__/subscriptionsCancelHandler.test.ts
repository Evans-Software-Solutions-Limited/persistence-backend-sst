/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const subscriptionRepositoryMocks = {
  findByIdForUser: vi.fn(),
  updateById: vi.fn(),
};

const stripeMock = {
  subscriptions: {
    cancel: vi.fn(),
    update: vi.fn(),
  },
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

vi.mock("../../../stripe/stripeClient", () => ({
  getStripe: () => stripeMock,
}));

function fakeRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "us_1",
    userId: "user-1",
    tierName: "premium",
    billingCycle: "monthly",
    paymentStatus: "active",
    expiresAt: new Date("2026-06-01"),
    cancelledAt: null,
    externalSubscriptionId: "sub_stripe_id",
    metadata: { platform: "ios" },
    ...over,
  };
}

async function postCancel(id: string, body: unknown = {}, withAuth = true) {
  const { subscriptionsCancelHandler } =
    await import("../subscriptionsCancelHandler");
  return subscriptionsCancelHandler.handle(
    new Request(`http://localhost/subscriptions/${id}/cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(withAuth ? { authorization: "Bearer test-token" } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  subscriptionRepositoryMocks.findByIdForUser.mockResolvedValue(fakeRow());
  subscriptionRepositoryMocks.updateById.mockImplementation(
    async (id: string, patch: Record<string, unknown>) => ({ id, ...patch }),
  );
  stripeMock.subscriptions.cancel.mockResolvedValue({
    id: "sub_stripe_id",
    canceled_at: 1717200000, // 2024-06-01
  } as unknown as Stripe.Subscription);
  stripeMock.subscriptions.update.mockResolvedValue({
    id: "sub_stripe_id",
    current_period_end: 1717200000,
    items: { data: [{ current_period_end: 1717200000 }] },
  } as unknown as Stripe.Subscription);
});

describe("subscriptionsCancelHandler", () => {
  describe("auth + lookup", () => {
    it("returns 401 without auth", async () => {
      const res = await postCancel("us_1", {}, false);
      expect(res.status).toBe(401);
    });

    it("returns 404 when the subscription is not found OR belongs to another user", async () => {
      subscriptionRepositoryMocks.findByIdForUser.mockResolvedValueOnce(null);
      const res = await postCancel("us_doesnt_exist");
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: "Subscription not found",
      });
      // No Stripe call attempted
      expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    });

    it("scopes the lookup by both id AND userId", async () => {
      await postCancel("us_1");
      expect(subscriptionRepositoryMocks.findByIdForUser).toHaveBeenCalledWith(
        "us_1",
        "user-1",
      );
    });

    it("returns 400 when the row is already cancelled", async () => {
      subscriptionRepositoryMocks.findByIdForUser.mockResolvedValueOnce(
        fakeRow({ paymentStatus: "cancelled" }),
      );
      const res = await postCancel("us_1");
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: "Subscription is already cancelled",
      });
      expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    });

    it("returns 400 ALSO for the US-spelled 'canceled' payment_status (Inspector Brad PR #70)", async () => {
      // Regression: the create handler's REINSTATEMENT_STATUSES treats
      // both UK + US spellings as valid local payment_statuses (legacy
      // rows + inbound Stripe pass-throughs both write US). The cancel
      // handler must do the same — otherwise a row with `canceled`
      // falls through to a fresh Stripe.cancel() against an already-
      // cancelled sub, surfacing as a 502 to the caller rather than
      // the friendly 400.
      subscriptionRepositoryMocks.findByIdForUser.mockResolvedValueOnce(
        fakeRow({ paymentStatus: "canceled" }),
      );
      const res = await postCancel("us_1");
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: "Subscription is already cancelled",
      });
      expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    });

    it("returns 404 when the row has no externalSubscriptionId", async () => {
      subscriptionRepositoryMocks.findByIdForUser.mockResolvedValueOnce(
        fakeRow({ externalSubscriptionId: null }),
      );
      const res = await postCancel("us_1");
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: expect.stringContaining("Stripe subscription id"),
      });
    });
  });

  describe("default (cancel at period end)", () => {
    it("schedules cancellation, preserves payment_status, stamps cancelledAt + expiresAt from Stripe", async () => {
      const res = await postCancel("us_1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body).toMatchObject({
        success: true,
        message: expect.stringContaining("end of the billing period"),
      });
      expect(body.cancelled_at).toEqual(expect.any(String));
      expect(body.subscription_ends_at).toEqual(expect.any(String));

      expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
        "sub_stripe_id",
        { cancel_at_period_end: true },
      );
      expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();

      const [, patch] = subscriptionRepositoryMocks.updateById.mock.calls[0];
      expect(patch.paymentStatus).toBe("active"); // preserved
      expect(patch.cancelledAt).toEqual(expect.any(Date));
      expect(
        (patch.metadata as Record<string, unknown>).cancel_immediately,
      ).toBe(false);
      expect((patch.metadata as Record<string, unknown>).cancelled_at).toEqual(
        expect.any(String),
      );
      // Original metadata preserved
      expect((patch.metadata as Record<string, unknown>).platform).toBe("ios");
    });

    it("uses items[0].current_period_end when top-level current_period_end is missing", async () => {
      stripeMock.subscriptions.update.mockResolvedValueOnce({
        id: "sub_stripe_id",
        items: { data: [{ current_period_end: 1717200000 }] },
      } as unknown as Stripe.Subscription);
      const res = await postCancel("us_1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.subscription_ends_at).toBe(
        new Date(1717200000 * 1000).toISOString(),
      );
    });

    it("falls back to existing expiresAt when Stripe returns no period end", async () => {
      stripeMock.subscriptions.update.mockResolvedValueOnce({
        id: "sub_stripe_id",
        items: { data: [] },
      } as unknown as Stripe.Subscription);
      const res = await postCancel("us_1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      // Falls back to the existing expiresAt on the row
      expect(body.subscription_ends_at).toBe(
        new Date("2026-06-01").toISOString(),
      );
    });

    it("falls back to cancelledAt (now) when Stripe AND existing expiresAt are missing", async () => {
      subscriptionRepositoryMocks.findByIdForUser.mockResolvedValueOnce(
        fakeRow({ expiresAt: null }),
      );
      stripeMock.subscriptions.update.mockResolvedValueOnce({
        id: "sub_stripe_id",
        items: { data: [] },
      } as unknown as Stripe.Subscription);
      const res = await postCancel("us_1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      // Should match the cancelledAt timestamp we just stamped — same value
      expect(body.subscription_ends_at).toBe(body.cancelled_at);
    });

    it("preserves trialing paymentStatus when scheduling cancellation", async () => {
      subscriptionRepositoryMocks.findByIdForUser.mockResolvedValueOnce(
        fakeRow({ paymentStatus: "trialing" }),
      );
      await postCancel("us_1");
      const [, patch] = subscriptionRepositoryMocks.updateById.mock.calls[0];
      expect(patch.paymentStatus).toBe("trialing");
    });

    it("returns 502 with a useful message when stripe.subscriptions.update throws", async () => {
      stripeMock.subscriptions.update.mockRejectedValueOnce(
        new Error("stripe 503"),
      );
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await postCancel("us_1");
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({
        error: expect.stringContaining("Failed to schedule"),
      });
      expect(subscriptionRepositoryMocks.updateById).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe("immediate cancel", () => {
    it("calls stripe.subscriptions.cancel + flips paymentStatus to cancelled", async () => {
      const res = await postCancel("us_1", { cancel_immediately: true });
      expect(res.status).toBe(200);
      expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(
        "sub_stripe_id",
      );
      expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
      const [, patch] = subscriptionRepositoryMocks.updateById.mock.calls[0];
      expect(patch.paymentStatus).toBe("cancelled");
      expect(
        (patch.metadata as Record<string, unknown>).cancel_immediately,
      ).toBe(true);
    });

    it("uses Stripe's canceled_at for subscription_ends_at", async () => {
      stripeMock.subscriptions.cancel.mockResolvedValueOnce({
        id: "sub_stripe_id",
        canceled_at: 1700000000,
      } as unknown as Stripe.Subscription);
      const res = await postCancel("us_1", { cancel_immediately: true });
      const body = (await res.json()) as any;
      expect(body.subscription_ends_at).toBe(
        new Date(1700000000 * 1000).toISOString(),
      );
    });

    it("falls back to the cancelledAt timestamp when Stripe omits canceled_at", async () => {
      stripeMock.subscriptions.cancel.mockResolvedValueOnce({
        id: "sub_stripe_id",
        canceled_at: null,
      } as unknown as Stripe.Subscription);
      const res = await postCancel("us_1", { cancel_immediately: true });
      const body = (await res.json()) as any;
      expect(body.subscription_ends_at).toBe(body.cancelled_at);
    });

    it("returns 502 with a useful message when stripe.subscriptions.cancel throws", async () => {
      stripeMock.subscriptions.cancel.mockRejectedValueOnce(
        new Error("stripe down"),
      );
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await postCancel("us_1", { cancel_immediately: true });
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({
        error: expect.stringContaining("Failed to cancel"),
      });
      expect(subscriptionRepositoryMocks.updateById).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe("DB write failure handling", () => {
    it("returns 500 with a support message when updateById returns null after Stripe success", async () => {
      subscriptionRepositoryMocks.updateById.mockResolvedValueOnce(null);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await postCancel("us_1", { cancel_immediately: true });
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({
        error: expect.stringContaining("contact support"),
      });
      errSpy.mockRestore();
    });
  });
});
