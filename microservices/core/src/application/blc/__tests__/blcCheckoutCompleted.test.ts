import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const reportMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);
vi.mock("../../tradedoubler/reportSale", () => ({
  reportTradedoublerSale: reportMock,
}));

const emitEventMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
);
vi.mock("../../analytics/emitEvent", () => ({ emitEvent: emitEventMock }));

const alertMock = vi.hoisted(() => vi.fn());
vi.mock("../../stripe/alerts", () => ({ emitStripeAlert: alertMock }));

import {
  handleBlcCheckoutCompleted,
  isBlcCheckoutSession,
} from "../blcCheckoutCompleted";

function session(
  over: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: "cs_blc_1",
    payment_status: "paid",
    amount_total: 11199,
    currency: "gbp",
    subscription: "sub_blc_1",
    metadata: {
      channel: "blc",
      tier: "premium",
      cadence: "annual",
      voucher: "BLC-TEST",
      tduid: "td_1",
      event_id: "evt-blc-1",
      marketing_consent: "true",
      fbp: "fb.1.1.xyz",
      fbc: "",
      campaign_slug: "blc-launch",
    },
    ...over,
  } as unknown as Stripe.Checkout.Session;
}

describe("handleBlcCheckoutCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportMock.mockResolvedValue({ skipped: false, ok: true, status: 200 });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("recognises only Sessions stamped with the BLC channel", () => {
    expect(isBlcCheckoutSession(session())).toBe(true);
    expect(isBlcCheckoutSession({ metadata: { tier: "premium" } })).toBe(false);
    expect(isBlcCheckoutSession({ metadata: null })).toBe(false);
  });

  it("reports the sale to Tradedoubler from the Session's own figures", async () => {
    await handleBlcCheckoutCompleted(session());
    expect(reportMock).toHaveBeenCalledWith({
      orderNumber: "cs_blc_1",
      orderValueMinor: 11199,
      currency: "GBP",
      voucher: "BLC-TEST",
      tduid: "td_1",
    });
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("emits the purchase conversion with the browser's dedup id", async () => {
    await handleBlcCheckoutCompleted(session());
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "purchase",
      source: "web",
      eventId: "evt-blc-1",
      properties: {
        marketing_consent: true,
        channel: "blc",
        tier: "premium",
        cadence: "annual",
        value: 111.99,
        currency: "GBP",
        fbp: "fb.1.1.xyz",
        campaign: "blc-launch",
      },
    });
  });

  it("alerts, but does not throw, when the partner could not be told", async () => {
    reportMock.mockResolvedValue({ skipped: false, ok: false, status: 502 });
    await expect(
      handleBlcCheckoutCompleted(session()),
    ).resolves.toBeUndefined();
    expect(alertMock).toHaveBeenCalledWith(
      "blc_checkout.tradedoubler_report_failed",
      "warn",
      expect.objectContaining({ stripeSessionId: "cs_blc_1", status: 502 }),
    );
    // The conversion still counts for us.
    expect(emitEventMock).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when Tradedoubler is simply not configured", async () => {
    reportMock.mockResolvedValue({ skipped: true });
    await handleBlcCheckoutCompleted(session());
    expect(alertMock).not.toHaveBeenCalled();
    expect(emitEventMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a completion that was not paid", async () => {
    await handleBlcCheckoutCompleted(session({ payment_status: "unpaid" }));
    expect(reportMock).not.toHaveBeenCalled();
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  it("falls back to a stable id and empty attribution when metadata is thin", async () => {
    await handleBlcCheckoutCompleted(
      session({
        metadata: { channel: "blc" },
        amount_total: null,
        currency: null,
      } as Partial<Stripe.Checkout.Session>),
    );
    expect(reportMock).toHaveBeenCalledWith({
      orderNumber: "cs_blc_1",
      orderValueMinor: 0,
      currency: "GBP",
      voucher: "",
      tduid: "",
    });
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "blc-purchase:cs_blc_1",
        properties: {
          marketing_consent: false,
          channel: "blc",
          tier: null,
          cadence: null,
          value: 0,
          currency: "GBP",
        },
      }),
    );
  });

  it("carries the Meta click id when the browser had one", async () => {
    await handleBlcCheckoutCompleted(
      session({
        metadata: { channel: "blc", fbc: "fb.1.1.click" },
      } as Partial<Stripe.Checkout.Session>),
    );
    expect(emitEventMock.mock.calls[0]![0]).toMatchObject({
      properties: { fbc: "fb.1.1.click" },
    });
  });
});
