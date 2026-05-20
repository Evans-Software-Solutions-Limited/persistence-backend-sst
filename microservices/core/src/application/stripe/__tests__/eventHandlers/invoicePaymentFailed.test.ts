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

import { handleInvoicePaymentFailed } from "../../eventHandlers/invoicePaymentFailed";

describe("handleInvoicePaymentFailed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByExternalIdMock.mockResolvedValue({
      id: "us_test",
      externalSubscriptionId: "sub_test",
    });
    updateByIdMock.mockResolvedValue({ id: "us_test" });
    subscriptionsRetrieveMock.mockResolvedValue({
      id: "sub_test",
      metadata: { supabase_user_id: "user-1" },
    });
  });

  function buildEvent(): Stripe.Event {
    return {
      id: "evt_failed",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_fail",
          subscription: "sub_test",
        } as unknown as Stripe.Invoice,
      },
    } as Stripe.Event;
  }

  it("updates payment_status to past_due", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleInvoicePaymentFailed(buildEvent());
    expect(updateByIdMock).toHaveBeenCalledWith(
      "us_test",
      expect.objectContaining({ paymentStatus: "past_due" }),
    );
    logSpy.mockRestore();
  });

  it("skips one-off invoices with no subscription id", async () => {
    const invoice = {
      id: "in_oneoff",
      subscription: null,
    } as unknown as Stripe.Invoice;
    const event = {
      id: "evt_inv",
      type: "invoice.payment_failed",
      data: { object: invoice },
    } as Stripe.Event;
    await handleInvoicePaymentFailed(event);
    expect(subscriptionsRetrieveMock).not.toHaveBeenCalled();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  it("warns and skips when no local row matches the external_subscription_id", async () => {
    findByExternalIdMock.mockResolvedValueOnce(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleInvoicePaymentFailed(buildEvent());
    expect(updateByIdMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
