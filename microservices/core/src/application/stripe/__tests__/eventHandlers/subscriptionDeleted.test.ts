/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const findByExternalIdMock = vi.fn();
const updateByIdMock = vi.fn();

vi.mock("../../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi.fn().mockImplementation(() => ({
    findByExternalId: findByExternalIdMock,
    updateById: updateByIdMock,
  })),
}));

import { handleSubscriptionDeleted } from "../../eventHandlers/subscriptionDeleted";

function buildEvent(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Event {
  const subscription = {
    id: "sub_del",
    metadata: { supabase_user_id: "user-1" },
    canceled_at: 1700000000,
    items: {
      data: [{ current_period_end: 1701000000 }],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
  return {
    id: "evt_del",
    type: "customer.subscription.deleted",
    data: { object: subscription },
  } as Stripe.Event;
}

describe("handleSubscriptionDeleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByExternalIdMock.mockResolvedValue({
      id: "us_test",
      externalSubscriptionId: "sub_del",
    });
    updateByIdMock.mockResolvedValue({ id: "us_test" });
  });

  it("updates payment_status, cancelled_at, expires_at on the matching row", async () => {
    await handleSubscriptionDeleted(buildEvent());
    expect(updateByIdMock).toHaveBeenCalledWith(
      "us_test",
      expect.objectContaining({
        paymentStatus: "cancelled",
        cancelledAt: new Date(1700000000 * 1000),
        expiresAt: new Date(1701000000 * 1000),
      }),
    );
  });

  it("falls back to now() for cancelled_at when Stripe omits canceled_at", async () => {
    await handleSubscriptionDeleted(
      buildEvent({ canceled_at: null } as Partial<Stripe.Subscription>),
    );
    const args = updateByIdMock.mock.calls[0][1];
    expect(args.cancelledAt).toBeInstanceOf(Date);
  });

  it("warns and skips when supabase_user_id is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleSubscriptionDeleted(
      buildEvent({ metadata: {} } as Partial<Stripe.Subscription>),
    );
    expect(updateByIdMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and skips when no local row matches the external_subscription_id", async () => {
    findByExternalIdMock.mockResolvedValueOnce(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleSubscriptionDeleted(buildEvent());
    expect(updateByIdMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
