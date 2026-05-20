/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const findByExternalIdMock = vi.fn();
const updateByIdMock = vi.fn();
const subscriptionsRetrieveMock = vi.fn();

vi.mock("../../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi.fn().mockImplementation(() => ({
    findByExternalId: findByExternalIdMock,
    updateById: updateByIdMock,
  })),
}));

vi.mock("../../stripeClient", () => ({
  getStripe: vi.fn(() => ({
    subscriptions: { retrieve: subscriptionsRetrieveMock },
  })),
  getStripeWebhookSecret: vi.fn(() => "whsec_test"),
}));

import { handleInvoicePaymentSucceeded } from "../../eventHandlers/invoicePaymentSucceeded";

function buildEvent(invoice: Partial<Stripe.Invoice> = {}): Stripe.Event {
  return {
    id: "evt_inv",
    type: "invoice.payment_succeeded",
    data: {
      object: {
        id: "in_test",
        subscription: "sub_test",
        ...invoice,
      } as unknown as Stripe.Invoice,
    },
  } as Stripe.Event;
}

const fakeSub = {
  id: "sub_test",
  status: "active",
  metadata: { supabase_user_id: "user-1" },
  trial_end: null,
  items: { data: [{ current_period_end: 1701000000 }] },
};

describe("handleInvoicePaymentSucceeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByExternalIdMock.mockResolvedValue({
      id: "us_test",
      externalSubscriptionId: "sub_test",
    });
    updateByIdMock.mockResolvedValue({ id: "us_test" });
    subscriptionsRetrieveMock.mockResolvedValue(fakeSub);
  });

  it("updates payment_status, next_billing_date, expires_at, trial_ends_at", async () => {
    await handleInvoicePaymentSucceeded(buildEvent());
    expect(updateByIdMock).toHaveBeenCalledWith(
      "us_test",
      expect.objectContaining({
        paymentStatus: "active",
        nextBillingDate: new Date(1701000000 * 1000),
        expiresAt: new Date(1701000000 * 1000),
        trialEndsAt: null,
      }),
    );
  });

  it("maps `trialing` subscription.status correctly", async () => {
    subscriptionsRetrieveMock.mockResolvedValueOnce({
      ...fakeSub,
      status: "trialing",
      trial_end: 1701500000,
    });
    await handleInvoicePaymentSucceeded(buildEvent());
    const args = updateByIdMock.mock.calls[0][1];
    expect(args.paymentStatus).toBe("trialing");
    expect(args.trialEndsAt).toEqual(new Date(1701500000 * 1000));
  });

  it("skips one-off invoices with no subscription id", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleInvoicePaymentSucceeded(
      buildEvent({ subscription: null } as Partial<Stripe.Invoice>),
    );
    expect(subscriptionsRetrieveMock).not.toHaveBeenCalled();
    expect(updateByIdMock).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("warns and skips when the retrieved subscription is missing supabase_user_id metadata", async () => {
    subscriptionsRetrieveMock.mockResolvedValueOnce({
      ...fakeSub,
      metadata: {},
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleInvoicePaymentSucceeded(buildEvent());
    expect(updateByIdMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
