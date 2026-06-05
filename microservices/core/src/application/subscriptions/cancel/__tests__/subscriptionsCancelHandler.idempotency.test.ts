/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { deriveCancelBaseKey, opKey } from "../../../stripe/stripeIdempotency";

const subscriptionRepositoryMocks = {
  findByIdForUser: vi.fn(),
  updateById: vi.fn(),
};
const stripeMock = {
  subscriptions: { cancel: vi.fn(), update: vi.fn() },
};

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) =>
    !authHeader || !authHeader.startsWith("Bearer ")
      ? null
      : {
          sub: "user-1",
          email: "t@e.com",
          email_verified: true,
          iat: 0,
          exp: 9e9,
        },
  ),
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

async function postCancel(id: string, body: unknown = {}) {
  const { subscriptionsCancelHandler } =
    await import("../subscriptionsCancelHandler");
  return subscriptionsCancelHandler.handle(
    new Request(`http://localhost/subscriptions/${id}/cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
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
    canceled_at: 1717200000,
  } as unknown as Stripe.Subscription);
  stripeMock.subscriptions.update.mockResolvedValue({
    id: "sub_stripe_id",
    current_period_end: 1717200000,
    items: { data: [{ current_period_end: 1717200000 }] },
  } as unknown as Stripe.Subscription);
});

describe("subscriptionsCancelHandler — idempotency keys (spec 17 / Phase A)", () => {
  it("passes a 'sub-cancel' key on the immediate-cancel path", async () => {
    const res = await postCancel("us_1", { cancel_immediately: true });
    expect(res.status).toBe(200);
    const base = deriveCancelBaseKey({
      userId: "user-1",
      localSubscriptionId: "us_1",
      cancelImmediately: true,
    });
    expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_stripe_id",
      undefined,
      { idempotencyKey: opKey(base, "sub-cancel") },
    );
  });

  it("passes a 'sub-update' key on the period-end path", async () => {
    const res = await postCancel("us_1", { cancel_immediately: false });
    expect(res.status).toBe(200);
    const base = deriveCancelBaseKey({
      userId: "user-1",
      localSubscriptionId: "us_1",
      cancelImmediately: false,
    });
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
      "sub_stripe_id",
      { cancel_at_period_end: true },
      { idempotencyKey: opKey(base, "sub-update") },
    );
  });

  it("uses a client-supplied idempotency_key as the base when provided", async () => {
    const res = await postCancel("us_1", {
      cancel_immediately: true,
      idempotency_key: "ck-cancel",
    });
    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_stripe_id",
      undefined,
      { idempotencyKey: "ck-cancel:sub-cancel" },
    );
  });
});
