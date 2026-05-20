/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const findByExternalIdMock = vi.fn();
const insertMock = vi.fn();

vi.mock("../../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi.fn().mockImplementation(() => ({
    findByExternalId: findByExternalIdMock,
    insert: insertMock,
  })),
}));

import { handleSubscriptionCreated } from "../../eventHandlers/subscriptionCreated";

function buildEvent(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Event {
  const subscription = {
    id: "sub_new",
    customer: "cus_123",
    metadata: {
      supabase_user_id: "user-1",
      tier_name: "premium",
      billing_cycle: "monthly",
    },
    status: "trialing",
    created: 1700000000,
    trial_end: 1700604800,
    items: {
      data: [{ current_period_end: 1700604800 }],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
  return {
    id: "evt_test",
    type: "customer.subscription.created",
    data: { object: subscription },
  } as Stripe.Event;
}

describe("handleSubscriptionCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByExternalIdMock.mockResolvedValue(null);
    insertMock.mockResolvedValue({ id: "us_test" });
  });

  it("warns and skips when supabase_user_id is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleSubscriptionCreated(
      buildEvent({ metadata: {} } as Partial<Stripe.Subscription>),
    );
    expect(insertMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("idempotent-skips when a local row already exists for this external_subscription_id", async () => {
    findByExternalIdMock.mockResolvedValueOnce({
      id: "us_existing",
      externalSubscriptionId: "sub_new",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleSubscriptionCreated(buildEvent());
    expect(insertMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("already present"),
    );
    logSpy.mockRestore();
  });

  it("inserts a fresh row with fields sourced from the Stripe event", async () => {
    await handleSubscriptionCreated(buildEvent());
    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = insertMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      userId: "user-1",
      tierName: "premium",
      billingCycle: "monthly",
      paymentStatus: "trialing",
      externalSubscriptionId: "sub_new",
    });
    expect(payload.startsAt).toBeInstanceOf(Date);
    expect(payload.expiresAt).toBeInstanceOf(Date);
    expect(payload.trialEndsAt).toBeInstanceOf(Date);
    expect(payload.metadata).toMatchObject({
      stripe_customer_id: "cus_123",
      stripe_subscription_id: "sub_new",
    });
  });

  it("falls back to 'basic' + 'monthly' when metadata.tier_name / billing_cycle are absent", async () => {
    await handleSubscriptionCreated(
      buildEvent({
        metadata: { supabase_user_id: "user-1" },
      } as Partial<Stripe.Subscription>),
    );
    const payload = insertMock.mock.calls[0][0];
    expect(payload.tierName).toBe("basic");
    expect(payload.billingCycle).toBe("monthly");
  });

  it("extracts the customer id when subscription.customer is an object", async () => {
    await handleSubscriptionCreated(
      buildEvent({
        customer: { id: "cus_obj" } as any,
      }),
    );
    const payload = insertMock.mock.calls[0][0];
    expect(payload.metadata.stripe_customer_id).toBe("cus_obj");
  });
});
