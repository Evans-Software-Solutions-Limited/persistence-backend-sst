/* eslint-disable @typescript-eslint/no-explicit-any */
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

// resolveTierForPrice uses dynamic imports of drizzle-orm + @persistence/db
// + @persistence/db/client. We mock the client to short-circuit DB access;
// the other dynamic imports resolve to their real modules at runtime, which
// is fine because the only thing they DO with those imports is build a
// query that the mocked client never executes.
const dbSelectMock = vi.fn();
vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(() => ({ select: dbSelectMock })),
}));

import { handleSubscriptionUpdated } from "../../eventHandlers/subscriptionUpdated";

function buildEvent(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Event {
  const now = Math.floor(Date.now() / 1000);
  const subscription = {
    id: "sub_test",
    metadata: { supabase_user_id: "user-1" },
    status: "active",
    cancel_at_period_end: false,
    canceled_at: null,
    cancel_at: null,
    trial_end: null,
    items: {
      data: [{ current_period_end: now + 30 * 24 * 60 * 60 }],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
  return {
    id: "evt_upd",
    type: "customer.subscription.updated",
    data: { object: subscription },
  } as Stripe.Event;
}

const fakeRow = {
  id: "us_test",
  externalSubscriptionId: "sub_test",
  cancelledAt: null as Date | null,
  metadata: {},
};

describe("handleSubscriptionUpdated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByExternalIdMock.mockResolvedValue(fakeRow);
    updateByIdMock.mockResolvedValue({ id: "us_test" });
    subscriptionsCancelMock.mockResolvedValue({ id: "sub_old" });
  });

  describe("basic update", () => {
    it("writes payment_status, expires_at, trial_ends_at, next_billing_date", async () => {
      await handleSubscriptionUpdated(buildEvent());
      expect(updateByIdMock).toHaveBeenCalledWith(
        "us_test",
        expect.objectContaining({
          paymentStatus: "active",
          expiresAt: expect.any(Date),
          nextBillingDate: expect.any(Date),
          trialEndsAt: null,
          cancelledAt: null,
        }),
      );
    });

    it("warns and skips when supabase_user_id is missing", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await handleSubscriptionUpdated(
        buildEvent({ metadata: {} } as Partial<Stripe.Subscription>),
      );
      expect(updateByIdMock).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("warns and skips when no local row matches the external_subscription_id", async () => {
      findByExternalIdMock.mockResolvedValueOnce(null);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await handleSubscriptionUpdated(buildEvent());
      expect(updateByIdMock).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("preserves an existing cancelled_at when cancel_at_period_end fires again", async () => {
      const previouslySetAt = new Date("2026-05-01T00:00:00Z");
      findByExternalIdMock.mockResolvedValueOnce({
        ...fakeRow,
        cancelledAt: previouslySetAt,
      });
      await handleSubscriptionUpdated(
        buildEvent({
          cancel_at_period_end: true,
        } as Partial<Stripe.Subscription>),
      );
      const args = updateByIdMock.mock.calls[0][1];
      expect(args.cancelledAt).toEqual(previouslySetAt);
    });
  });

  describe("scheduled-downgrade activation", () => {
    it("flips tier_name when period has ended + metadata.scheduled_downgrade is set", async () => {
      const pastPeriodEnd = Math.floor(Date.now() / 1000) - 60;
      findByExternalIdMock
        .mockResolvedValueOnce({
          ...fakeRow,
          metadata: { scheduled_downgrade: { new_tier: "premium" } },
        })
        .mockResolvedValueOnce({
          ...fakeRow,
          metadata: { scheduled_downgrade: { new_tier: "premium" } },
        });
      await handleSubscriptionUpdated(
        buildEvent({
          cancel_at_period_end: true,
          items: {
            data: [{ current_period_end: pastPeriodEnd }],
          } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
        }),
      );
      // First call: basic update. Second call: scheduled-downgrade activation.
      expect(updateByIdMock).toHaveBeenCalledWith(
        "us_test",
        expect.objectContaining({
          tierName: "premium",
          cancelledAt: null,
          // metadata.scheduled_downgrade should be stripped on the
          // activation write.
          metadata: expect.not.objectContaining({
            scheduled_downgrade: expect.anything(),
          }),
        }),
      );
    });

    it("clears the marker + warns when new_tier is malformed (Inspector Brad medium-severity)", async () => {
      // Malformed new_tier: undefined / "" / non-string. Without the fix
      // the branch silently no-ops, leaving scheduled_downgrade in
      // metadata forever and every subsequent .updated event re-entering
      // the dead branch.
      const pastPeriodEnd = Math.floor(Date.now() / 1000) - 60;
      const cases: unknown[] = [undefined, "", 42];
      for (const malformed of cases) {
        vi.clearAllMocks();
        findByExternalIdMock.mockResolvedValue({
          ...fakeRow,
          metadata: { scheduled_downgrade: { new_tier: malformed } },
        });
        updateByIdMock.mockResolvedValue({ id: "us_test" });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        await handleSubscriptionUpdated(
          buildEvent({
            cancel_at_period_end: true,
            items: {
              data: [{ current_period_end: pastPeriodEnd }],
            } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
          }),
        );

        // The marker must be cleared (no scheduled_downgrade in the
        // final metadata) AND no tier_name update should have happened.
        const malformedCall = updateByIdMock.mock.calls.find(
          (c) =>
            c[1].metadata &&
            !("scheduled_downgrade" in (c[1].metadata as object)) &&
            !("tierName" in c[1]),
        );
        expect(malformedCall).toBeDefined();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("malformed new_tier"),
        );
        warnSpy.mockRestore();
      }
    });

    it("downgrades to free with payment_status=cancelled when scheduled_downgrade.new_tier='free'", async () => {
      const pastPeriodEnd = Math.floor(Date.now() / 1000) - 60;
      findByExternalIdMock.mockResolvedValue({
        ...fakeRow,
        metadata: { scheduled_downgrade: { new_tier: "free" } },
      });
      await handleSubscriptionUpdated(
        buildEvent({
          cancel_at_period_end: true,
          items: {
            data: [{ current_period_end: pastPeriodEnd }],
          } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
        }),
      );
      const calls = updateByIdMock.mock.calls;
      // Find the "free downgrade" call — it sets tierName: "free" + paymentStatus: "cancelled".
      const downgradeCall = calls.find(
        (c) => c[1].tierName === "free" && c[1].paymentStatus === "cancelled",
      );
      expect(downgradeCall).toBeDefined();
    });
  });

  describe("subscription-change commit", () => {
    it("cancels the old Stripe sub and clears metadata.old_stripe_subscription_id on success", async () => {
      findByExternalIdMock.mockResolvedValue({
        ...fakeRow,
        metadata: { old_stripe_subscription_id: "sub_old" },
      });
      subscriptionsCancelMock.mockResolvedValueOnce({ id: "sub_old" });
      await handleSubscriptionUpdated(buildEvent());
      expect(subscriptionsCancelMock).toHaveBeenCalledWith(
        "sub_old",
        undefined,
        expect.objectContaining({ idempotencyKey: expect.any(String) }),
      );
      const clearCall = updateByIdMock.mock.calls.find(
        (c) =>
          c[1].metadata &&
          !("old_stripe_subscription_id" in (c[1].metadata as object)),
      );
      expect(clearCall).toBeDefined();
    });

    it("treats `resource_missing` from cancel as success (sub already cancelled on Stripe; Inspector Brad medium)", async () => {
      // The non-atomic failure mode: previous delivery cancelled on
      // Stripe's side but couldn't commit the local metadata clear.
      // Stripe retries the event → we re-enter the commit branch →
      // cancel call now hits an already-gone subscription. Without the
      // fix this errors 3× per attempt and never clears the marker.
      findByExternalIdMock.mockResolvedValue({
        ...fakeRow,
        metadata: { old_stripe_subscription_id: "sub_old" },
      });
      const stripeError = Object.assign(new Error("No such subscription"), {
        code: "resource_missing",
      });
      subscriptionsCancelMock.mockRejectedValueOnce(stripeError);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await handleSubscriptionUpdated(buildEvent());

      // Only ONE cancel attempt — we recognised "already canceled" and
      // proceeded straight to the metadata clear instead of retrying.
      expect(subscriptionsCancelMock).toHaveBeenCalledTimes(1);
      const clearCall = updateByIdMock.mock.calls.find(
        (c) =>
          c[1].metadata &&
          !("old_stripe_subscription_id" in (c[1].metadata as object)),
      );
      expect(clearCall).toBeDefined();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("already cancelled"),
      );
      logSpy.mockRestore();
    });

    it("treats 'already cancelled' error messages as success even without resource_missing code", async () => {
      // Belt-and-braces: Stripe's text "Subscription has been canceled"
      // (some endpoints don't set the standard code field on this error).
      findByExternalIdMock.mockResolvedValue({
        ...fakeRow,
        metadata: { old_stripe_subscription_id: "sub_old" },
      });
      subscriptionsCancelMock.mockRejectedValueOnce(
        new Error("This subscription has been canceled"),
      );
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await handleSubscriptionUpdated(buildEvent());

      expect(subscriptionsCancelMock).toHaveBeenCalledTimes(1);
      const clearCall = updateByIdMock.mock.calls.find(
        (c) =>
          c[1].metadata &&
          !("old_stripe_subscription_id" in (c[1].metadata as object)),
      );
      expect(clearCall).toBeDefined();
      logSpy.mockRestore();
    });

    it("logs and preserves metadata when cancelling the old sub fails permanently", async () => {
      findByExternalIdMock.mockResolvedValue({
        ...fakeRow,
        metadata: { old_stripe_subscription_id: "sub_old" },
      });
      subscriptionsCancelMock.mockRejectedValue(
        new Error("Stripe unreachable"),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await handleSubscriptionUpdated(buildEvent());

      // 3 attempts after the linear backoff.
      expect(subscriptionsCancelMock).toHaveBeenCalledTimes(3);
      // No "clear metadata" call (no update without old_stripe_subscription_id).
      const clearCall = updateByIdMock.mock.calls.find(
        (c) =>
          c[1].metadata &&
          !("old_stripe_subscription_id" in (c[1].metadata as object)),
      );
      expect(clearCall).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("manual intervention required"),
      );

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }, 10000);
  });

  describe("subscription-change rollback", () => {
    it("restores the local row from the original Stripe subscription on incomplete_expired", async () => {
      findByExternalIdMock.mockResolvedValue({
        ...fakeRow,
        metadata: {
          old_stripe_subscription_id: "sub_old",
          stripe_subscription_id: "sub_test",
        },
      });
      // resolveTierForPrice: return a tier match for the original price id.
      dbSelectMock.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                tierName: "premium",
                monthly: "price_basic_monthly",
                yearly: "price_basic_yearly",
              },
            ]),
          }),
        }),
      });
      const originalEnd = Math.floor(Date.now() / 1000) + 86400;
      subscriptionsRetrieveMock.mockResolvedValueOnce({
        id: "sub_old",
        status: "active",
        trial_end: null,
        items: {
          data: [
            {
              current_period_end: originalEnd,
              price: { id: "price_basic_monthly" },
            },
          ],
        },
      });

      await handleSubscriptionUpdated(
        buildEvent({
          status: "incomplete_expired",
        } as Partial<Stripe.Subscription>),
      );

      const restoreCall = updateByIdMock.mock.calls.find(
        (c) => c[1].externalSubscriptionId === "sub_old",
      );
      expect(restoreCall).toBeDefined();
      expect(restoreCall![1]).toMatchObject({
        externalSubscriptionId: "sub_old",
        tierName: "premium",
        billingCycle: "monthly",
        paymentStatus: "active",
        // Inspector Brad sweep #3 low-severity find: the basic-update
        // pass above stamps cancelledAt from the FAILED sub's data
        // (incomplete_expired has canceled_at set by Stripe). Without
        // an explicit null in the restoration, the UI would render
        // "Active until X" + "Cancelled at Y" together for the
        // restored original sub. Pin the null so a regression shows
        // up here.
        cancelledAt: null,
      });
    });

    it("falls back to restoring only the external_subscription_id when Stripe.retrieve fails", async () => {
      findByExternalIdMock.mockResolvedValue({
        ...fakeRow,
        metadata: {
          old_stripe_subscription_id: "sub_old",
        },
      });
      subscriptionsRetrieveMock.mockRejectedValueOnce(
        new Error("Stripe unreachable"),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await handleSubscriptionUpdated(
        buildEvent({
          status: "incomplete_expired",
        } as Partial<Stripe.Subscription>),
      );

      // Fallback call: only sets externalSubscriptionId (no tier_name, etc.).
      const fallbackCall = updateByIdMock.mock.calls.find(
        (c) =>
          c[1].externalSubscriptionId === "sub_old" && !("tierName" in c[1]),
      );
      expect(fallbackCall).toBeDefined();
      // Same cancelledAt-cleanup as the happy-path restoration — even
      // when we can't reach Stripe, we shouldn't leave the row
      // advertising a cancelled date for what's now the active sub.
      expect(fallbackCall![1]).toMatchObject({
        cancelledAt: null,
      });

      errorSpy.mockRestore();
    });
  });
});
