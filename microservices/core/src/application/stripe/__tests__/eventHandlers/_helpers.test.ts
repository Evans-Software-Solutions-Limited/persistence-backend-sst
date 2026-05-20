/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  mapStripeStatusToPaymentStatus,
  mapStripeStatusToPaymentStatusForUpdate,
  readCurrentPeriodEnd,
  readInvoiceSubscriptionId,
  readUserIdFromMetadata,
  resolveExpiresAt,
  unixSecondsToDate,
} from "../../eventHandlers/_helpers";

describe("_helpers", () => {
  describe("mapStripeStatusToPaymentStatus", () => {
    it("maps the four happy-path statuses", () => {
      expect(mapStripeStatusToPaymentStatus("trialing")).toBe("trialing");
      expect(mapStripeStatusToPaymentStatus("active")).toBe("active");
      expect(mapStripeStatusToPaymentStatus("past_due")).toBe("past_due");
    });

    it("defaults to pending for unrecognised statuses", () => {
      expect(
        mapStripeStatusToPaymentStatus(
          "incomplete" as Stripe.Subscription.Status,
        ),
      ).toBe("pending");
      expect(
        mapStripeStatusToPaymentStatus("paused" as Stripe.Subscription.Status),
      ).toBe("pending");
    });
  });

  describe("mapStripeStatusToPaymentStatusForUpdate", () => {
    function sub(overrides: any): Stripe.Subscription {
      return { ...overrides } as Stripe.Subscription;
    }

    it("preserves 'active' for scheduled cancellation that hasn't ended yet", () => {
      const future = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
      expect(
        mapStripeStatusToPaymentStatusForUpdate(
          sub({
            status: "canceled",
            canceled_at: 1700000000,
            items: { data: [{ current_period_end: future }] },
          }),
        ),
      ).toBe("active");
    });

    it("returns 'cancelled' when canceled_at + period has elapsed", () => {
      const past = Math.floor(Date.now() / 1000) - 60;
      expect(
        mapStripeStatusToPaymentStatusForUpdate(
          sub({
            status: "canceled",
            canceled_at: 1700000000,
            items: { data: [{ current_period_end: past }] },
          }),
        ),
      ).toBe("cancelled");
    });

    it("returns 'cancelled' for canceled status without canceled_at", () => {
      expect(
        mapStripeStatusToPaymentStatusForUpdate(
          sub({ status: "canceled", canceled_at: null }),
        ),
      ).toBe("cancelled");
    });

    it("maps 'unpaid' to 'expired'", () => {
      expect(
        mapStripeStatusToPaymentStatusForUpdate(sub({ status: "unpaid" })),
      ).toBe("expired");
    });

    it("defaults unknown statuses to 'pending'", () => {
      expect(
        mapStripeStatusToPaymentStatusForUpdate(sub({ status: "incomplete" })),
      ).toBe("pending");
    });

    it("returns trialing / active / past_due directly", () => {
      expect(
        mapStripeStatusToPaymentStatusForUpdate(sub({ status: "trialing" })),
      ).toBe("trialing");
      expect(
        mapStripeStatusToPaymentStatusForUpdate(sub({ status: "active" })),
      ).toBe("active");
      expect(
        mapStripeStatusToPaymentStatusForUpdate(sub({ status: "past_due" })),
      ).toBe("past_due");
    });
  });

  describe("unixSecondsToDate", () => {
    it("converts a unix-seconds number to a Date", () => {
      expect(unixSecondsToDate(1700000000)).toEqual(
        new Date(1700000000 * 1000),
      );
    });

    it("returns null for null / undefined / 0", () => {
      expect(unixSecondsToDate(null)).toBeNull();
      expect(unixSecondsToDate(undefined)).toBeNull();
      expect(unixSecondsToDate(0)).toBeNull();
    });
  });

  describe("readCurrentPeriodEnd", () => {
    it("prefers the legacy top-level field when present", () => {
      const subscription = {
        current_period_end: 1700000000,
        items: { data: [{ current_period_end: 9999999999 }] },
      } as unknown as Stripe.Subscription;
      expect(readCurrentPeriodEnd(subscription)).toBe(1700000000);
    });

    it("falls back to items[0].current_period_end on newer API versions", () => {
      const subscription = {
        items: { data: [{ current_period_end: 1700000000 }] },
      } as unknown as Stripe.Subscription;
      expect(readCurrentPeriodEnd(subscription)).toBe(1700000000);
    });

    it("returns null when neither path has a usable value", () => {
      expect(
        readCurrentPeriodEnd({
          items: { data: [] },
        } as unknown as Stripe.Subscription),
      ).toBeNull();
      expect(
        readCurrentPeriodEnd({
          current_period_end: 0,
          items: { data: [{ current_period_end: 0 }] },
        } as unknown as Stripe.Subscription),
      ).toBeNull();
    });
  });

  describe("readInvoiceSubscriptionId", () => {
    it("reads the legacy string form", () => {
      expect(
        readInvoiceSubscriptionId({
          subscription: "sub_legacy",
        } as unknown as Stripe.Invoice),
      ).toBe("sub_legacy");
    });

    it("reads the legacy object form", () => {
      expect(
        readInvoiceSubscriptionId({
          subscription: { id: "sub_obj" },
        } as unknown as Stripe.Invoice),
      ).toBe("sub_obj");
    });

    it("falls back to parent.subscription_details.subscription on newer API versions", () => {
      expect(
        readInvoiceSubscriptionId({
          subscription: null,
          parent: { subscription_details: { subscription: "sub_parent" } },
        } as unknown as Stripe.Invoice),
      ).toBe("sub_parent");
    });

    it("returns null for one-off invoices with no subscription reference", () => {
      expect(
        readInvoiceSubscriptionId({} as unknown as Stripe.Invoice),
      ).toBeNull();
      expect(
        readInvoiceSubscriptionId({
          subscription: null,
        } as unknown as Stripe.Invoice),
      ).toBeNull();
      expect(
        readInvoiceSubscriptionId({
          subscription: null,
          parent: { subscription_details: { subscription: null } },
        } as unknown as Stripe.Invoice),
      ).toBeNull();
    });
  });

  describe("resolveExpiresAt", () => {
    it("prefers cancel_at when set (scheduled cancellation effective date)", () => {
      const subscription = {
        cancel_at: 1700000000,
        items: { data: [{ current_period_end: 9999999999 }] },
      } as unknown as Stripe.Subscription;
      expect(resolveExpiresAt(subscription)).toEqual(
        new Date(1700000000 * 1000),
      );
    });

    it("falls back to readCurrentPeriodEnd when cancel_at is missing", () => {
      const subscription = {
        cancel_at: null,
        items: { data: [{ current_period_end: 1700000000 }] },
      } as unknown as Stripe.Subscription;
      expect(resolveExpiresAt(subscription)).toEqual(
        new Date(1700000000 * 1000),
      );
    });

    it("returns null when neither cancel_at nor any period_end is available", () => {
      expect(
        resolveExpiresAt({
          cancel_at: null,
          items: { data: [] },
        } as unknown as Stripe.Subscription),
      ).toBeNull();
    });
  });

  describe("readUserIdFromMetadata", () => {
    it("extracts supabase_user_id when present", () => {
      expect(
        readUserIdFromMetadata({
          metadata: { supabase_user_id: "user-1" },
        } as unknown as Stripe.Subscription),
      ).toBe("user-1");
    });

    it("returns null for missing / empty / wrong-type values", () => {
      expect(
        readUserIdFromMetadata({
          metadata: {},
        } as unknown as Stripe.Subscription),
      ).toBeNull();
      expect(
        readUserIdFromMetadata({
          metadata: { supabase_user_id: "" },
        } as unknown as Stripe.Subscription),
      ).toBeNull();
      expect(
        readUserIdFromMetadata({
          metadata: { supabase_user_id: 42 as unknown as string },
        } as unknown as Stripe.Subscription),
      ).toBeNull();
      expect(
        readUserIdFromMetadata({
          metadata: undefined,
        } as unknown as Stripe.Subscription),
      ).toBeNull();
    });
  });
});
