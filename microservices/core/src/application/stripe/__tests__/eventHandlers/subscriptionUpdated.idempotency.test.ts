import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const findByExternalIdMock = vi.fn();
const updateByIdMock = vi.fn();
const subscriptionsRetrieveMock = vi.fn();
const subscriptionsCancelMock = vi.fn();

vi.mock("../../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi.fn().mockImplementation(() => ({
    findByExternalId: findByExternalIdMock,
    updateById: updateByIdMock,
  })),
}));

vi.mock("../../stripeClient", () => ({
  getStripe: vi.fn(() => ({
    subscriptions: {
      retrieve: subscriptionsRetrieveMock,
      cancel: subscriptionsCancelMock,
    },
  })),
  getStripeWebhookSecret: vi.fn(() => "whsec_test"),
}));

const dbSelectMock = vi.fn();
vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(() => ({ select: dbSelectMock })),
}));

import { handleSubscriptionUpdated } from "../../eventHandlers/subscriptionUpdated";

function buildEvent(status: Stripe.Subscription.Status): Stripe.Event {
  const now = Math.floor(Date.now() / 1000);
  const subscription = {
    id: "sub_new",
    metadata: { supabase_user_id: "user-1" },
    status,
    cancel_at_period_end: false,
    canceled_at: null,
    cancel_at: null,
    trial_end: null,
    items: { data: [{ current_period_end: now + 30 * 24 * 60 * 60 }] },
  } as unknown as Stripe.Subscription;
  return {
    id: "evt_upd",
    type: "customer.subscription.updated",
    data: { object: subscription },
  } as Stripe.Event;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Local row carries the in-flight change marker → the active/trialing
  // branch cancels the OLD sub.
  findByExternalIdMock.mockResolvedValue({
    id: "us_test",
    externalSubscriptionId: "sub_new",
    cancelledAt: null,
    metadata: { old_stripe_subscription_id: "sub_old" },
  });
  updateByIdMock.mockResolvedValue({ id: "us_test" });
  subscriptionsCancelMock.mockResolvedValue({ id: "sub_old" });
});

describe("handleSubscriptionUpdated — cancel-old idempotency (spec 17 / Phase A)", () => {
  it("cancels the old sub with a deterministic idempotency key keyed on the old id", async () => {
    await handleSubscriptionUpdated(buildEvent("active"));
    expect(subscriptionsCancelMock).toHaveBeenCalledWith("sub_old", undefined, {
      idempotencyKey: "sub-cancel:sub_old",
    });
  });

  it("uses the same keying for a trialing successor sub", async () => {
    await handleSubscriptionUpdated(buildEvent("trialing"));
    expect(subscriptionsCancelMock).toHaveBeenCalledWith("sub_old", undefined, {
      idempotencyKey: "sub-cancel:sub_old",
    });
  });
});
