import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const checkoutMocks = vi.hoisted(() => ({
  findByStripeSessionId: vi.fn<(...args: unknown[]) => Promise<unknown>>(
    async () => null,
  ),
  recoverPaidReservation: vi.fn<(...args: unknown[]) => Promise<unknown>>(
    async () => null,
  ),
  claimForCompletion: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  attachGrant: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  markExpired: vi.fn<(...args: unknown[]) => Promise<boolean>>(
    async () => true,
  ),
  clearReferral: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
}));
vi.mock("../../../repositories/foundingCheckoutRepository", () => ({
  FoundingCheckoutRepository: class {
    findByStripeSessionId = checkoutMocks.findByStripeSessionId;
    recoverPaidReservation = checkoutMocks.recoverPaidReservation;
    claimForCompletion = checkoutMocks.claimForCompletion;
    attachGrant = checkoutMocks.attachGrant;
    clearReferral = checkoutMocks.clearReferral;
    markExpired = checkoutMocks.markExpired;
  },
}));

const priorGrant = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null),
);
vi.mock("../../../repositories/foundingGrantRepository", () => ({
  FoundingGrantRepository: class {
    findById = priorGrant;
  },
}));

const grantMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);
vi.mock("../../../founding/foundingGrantService", () => ({
  FoundingGrantService: class {
    grant = grantMock;
  },
}));

const auditMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
);
vi.mock("../../../repositories/adminAuditRepository", () => ({
  AdminAuditRepository: class {
    record = auditMock;
  },
}));

const emitEventMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
);
vi.mock("../../../analytics/emitEvent", () => ({ emitEvent: emitEventMock }));

const sendEmailMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
);
vi.mock("../../../leads/resendClient", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  RESEND_NOTIFICATION_TO: "admin@example.test",
}));

import { handleCheckoutSessionCompleted } from "../../eventHandlers/checkoutSessionCompleted";
import { handleCheckoutSessionExpired } from "../../eventHandlers/checkoutSessionExpired";

function event(
  type: string,
  session: Partial<Stripe.Checkout.Session>,
): Stripe.Event {
  return {
    id: `evt_${type}`,
    type,
    data: {
      object: {
        id: "cs_test_1",
        payment_status: "paid",
        amount_total: 3000,
        currency: "gbp",
        payment_intent: "pi_1",
        ...session,
      },
    },
  } as unknown as Stripe.Event;
}

const CLAIMED = {
  id: "checkout-row-1",
  email: "buyer@example.test",
  tierName: "premium",
  months: 6,
  amountMinor: 3000,
  currency: "GBP",
  referralCode: "METAFOUND",
  campaignSlug: "meta",
  eventId: "evt-checkout-1",
  fbp: "fb.1.1.xyz",
  fbc: null,
  marketingConsent: true,
};

describe("handleCheckoutSessionCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    priorGrant.mockResolvedValue(null);
    checkoutMocks.recoverPaidReservation.mockResolvedValue(null);
    checkoutMocks.findByStripeSessionId.mockResolvedValue(null);
    checkoutMocks.claimForCompletion.mockResolvedValue(CLAIMED);
    checkoutMocks.attachGrant.mockResolvedValue(undefined);
    checkoutMocks.clearReferral.mockResolvedValue(undefined);
    grantMock.mockResolvedValue({
      ok: true,
      result: { grantId: "grant-1", status: "pending" },
    });
  });

  it("records an unmatched paid reservation for review rather than losing it silently", async () => {
    checkoutMocks.claimForCompletion.mockResolvedValue(null);
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {
        metadata: {
          founding_reservation_id: "00000000-0000-4000-8000-000000000077",
        },
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "reservation_recovery_failed" }),
    );
    expect(grantMock).not.toHaveBeenCalled();
  });

  it("does not flag already-completed bound sessions as failed recovery", async () => {
    checkoutMocks.claimForCompletion.mockResolvedValue(null);
    checkoutMocks.findByStripeSessionId.mockResolvedValue({
      ...CLAIMED,
      grantId: "existing",
    });
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {
        metadata: {
          founding_reservation_id: "00000000-0000-4000-8000-000000000077",
        },
      }),
    );
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("recovers purchase analytics after grant attachment committed before process exit", async () => {
    checkoutMocks.claimForCompletion.mockResolvedValue(null);
    checkoutMocks.findByStripeSessionId.mockResolvedValue({
      ...CLAIMED,
      accountId: "apple-user",
      grantId: CLAIMED.id,
      status: "completed",
    });
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {
        metadata: {
          founding_reservation_id: "00000000-0000-4000-8000-000000000077",
        },
      }),
    );
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "purchase", eventId: CLAIMED.eventId }),
    );
    expect(grantMock).not.toHaveBeenCalled();
    expect(checkoutMocks.attachGrant).not.toHaveBeenCalled();
  });

  it("refuses to attach an existing deterministic grant with a different payment reference", async () => {
    checkoutMocks.claimForCompletion.mockResolvedValue({
      ...CLAIMED,
      accountId: "apple-user",
    });
    priorGrant.mockResolvedValue({
      id: CLAIMED.id,
      paymentReference: "pi_different",
    });
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {}),
    );
    expect(checkoutMocks.attachGrant).not.toHaveBeenCalled();
    expect(grantMock).not.toHaveBeenCalled();
    expect(emitEventMock).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "payment_reference_mismatch" }),
    );
  });

  it.each([new Error("db unavailable"), "db unavailable"])(
    "still grants access without false referral attribution when clearing the referral fails: %s",
    async (failure) => {
      grantMock
        .mockResolvedValueOnce({
          ok: false,
          error: { code: "invalid_referral_code" },
        })
        .mockResolvedValueOnce({ ok: true, result: { grantId: "grant-1" } });
      checkoutMocks.clearReferral.mockRejectedValueOnce(failure);
      await handleCheckoutSessionCompleted(
        event("checkout.session.completed", {}),
      );
      expect(grantMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ referralCode: null }),
        expect.any(String),
      );
      expect(checkoutMocks.attachGrant).toHaveBeenCalledWith(
        CLAIMED.id,
        "grant-1",
      );
      expect(emitEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "purchase",
          properties: expect.not.objectContaining({
            ref: CLAIMED.referralCode,
          }),
        }),
      );
    },
  );

  it("recovers an unattached paid session by its server-created reservation metadata", async () => {
    checkoutMocks.claimForCompletion.mockResolvedValue(null);
    const id = "00000000-0000-4000-8000-000000000077";
    checkoutMocks.recoverPaidReservation.mockResolvedValue({
      ...CLAIMED,
      id,
      accountId: "apple-user",
    });
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {
        metadata: { founding_reservation_id: id, userId: "attacker" },
      }),
    );
    expect(checkoutMocks.recoverPaidReservation).toHaveBeenCalledWith({
      reservationId: id,
      stripeSessionId: "cs_test_1",
      amountMinor: 3000,
      currency: "GBP",
    });
    expect(grantMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "apple-user", checkoutId: id }),
      expect.any(String),
    );
  });

  it("activates the immutable account binding even when Stripe metadata names somebody else", async () => {
    checkoutMocks.claimForCompletion.mockResolvedValue({
      ...CLAIMED,
      accountId: "apple-user",
    });
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {
        metadata: { userId: "attacker", email: "wrong@example.com" },
      }),
    );
    expect(grantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "apple-user",
        checkoutId: CLAIMED.id,
        email: CLAIMED.email,
      }),
      expect.any(String),
    );
  });

  it("recovers a committed grant after a lost attach response without extending access", async () => {
    checkoutMocks.claimForCompletion.mockResolvedValue({
      ...CLAIMED,
      accountId: "apple-user",
    });
    priorGrant.mockResolvedValue({
      id: CLAIMED.id,
      paymentReference: "pi_1",
      userId: "apple-user",
    });
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {}),
    );
    expect(checkoutMocks.attachGrant).toHaveBeenCalledWith(
      CLAIMED.id,
      CLAIMED.id,
    );
    expect(grantMock).not.toHaveBeenCalled();
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "purchase", eventId: CLAIMED.eventId }),
    );
  });

  it("uses one stable purchase event ID when an older bound checkout had no browser ID", async () => {
    checkoutMocks.claimForCompletion.mockResolvedValue({
      ...CLAIMED,
      accountId: "apple-user",
      eventId: null,
    });
    priorGrant.mockResolvedValue({ id: CLAIMED.id, paymentReference: "pi_1" });
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {}),
    );
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {}),
    );
    expect(emitEventMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: "purchase",
        eventId: `founding-purchase:${CLAIMED.id}`,
      }),
    );
    expect(emitEventMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: "purchase",
        eventId: `founding-purchase:${CLAIMED.id}`,
      }),
    );
    expect(grantMock).not.toHaveBeenCalled();
  });

  it("does not activate a deleted account using its purchase email instead", async () => {
    checkoutMocks.claimForCompletion.mockResolvedValue({
      ...CLAIMED,
      accountId: "deleted-user",
    });
    grantMock.mockResolvedValue({
      ok: false,
      error: { code: "user_not_found" },
    });
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {}),
    );
    expect(grantMock).toHaveBeenCalledTimes(1);
    expect(grantMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "deleted-user" }),
      expect.any(String),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "founding_checkout.needs_review",
        reason: "user_not_found",
      }),
    );
  });

  it.each([{ payment_intent: null }, { amount_total: 1 }, { currency: "usd" }])(
    "keeps mismatched payment details in review: %j",
    async (detail) => {
      checkoutMocks.claimForCompletion.mockResolvedValue({
        ...CLAIMED,
        accountId: "apple-user",
      });
      await handleCheckoutSessionCompleted(
        event("checkout.session.completed", detail),
      );
      expect(grantMock).not.toHaveBeenCalled();
      expect(auditMock).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "payment_details_mismatch" }),
      );
    },
  );

  it("retries a bound checkout when attaching its grant fails", async () => {
    checkoutMocks.claimForCompletion.mockResolvedValue({
      ...CLAIMED,
      accountId: "apple-user",
    });
    checkoutMocks.attachGrant.mockRejectedValueOnce(new Error("db offline"));
    await expect(
      handleCheckoutSessionCompleted(event("checkout.session.completed", {})),
    ).rejects.toThrow("db offline");
  });

  it("turns a paid session into a founding grant with the payment recorded", async () => {
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {}),
    );
    expect(grantMock).toHaveBeenCalledTimes(1);
    const [req, actor] = grantMock.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(req).toMatchObject({
      email: "buyer@example.test",
      tierName: "premium",
      grantKind: "founding",
      months: 6,
      contributionAmountMinor: 3000,
      contributionCurrency: "GBP",
      contributionMethod: "stripe_checkout",
      contributionReference: "pi_1",
      referralCode: "METAFOUND",
      sendInvite: true,
    });
    expect(req.notes).toContain("cs_test_1");
    // Not an administrator — nobody in /admin did this.
    expect(actor).toBe("00000000-0000-0000-0000-000000000000");
    expect(checkoutMocks.attachGrant).toHaveBeenCalledWith(
      "checkout-row-1",
      "grant-1",
    );
  });

  it("consumes a pool place, like any founding grant", async () => {
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {}),
    );
    expect(
      (grantMock.mock.calls[0]![0] as { grantKind: string }).grantKind,
    ).toBe("founding");
  });

  it("emits purchase with the value, currency and attribution", async () => {
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {}),
    );
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "purchase",
      source: "web",
      eventId: "evt-checkout-1",
      properties: {
        marketing_consent: true,
        value: 30,
        currency: "GBP",
        tier: "premium",
        months: 6,
        fbp: "fb.1.1.xyz",
        campaign: "meta",
        ref: "METAFOUND",
      },
    });
  });

  it("reads the amount from the Session, not from the stored row", async () => {
    // Stripe is the authority on what was actually taken.
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", { amount_total: 6000 }),
    );
    expect(
      (grantMock.mock.calls[0]![0] as { contributionAmountMinor: number })
        .contributionAmountMinor,
    ).toBe(6000);
  });

  it("accepts an expanded payment intent object as well as an id", async () => {
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {
        payment_intent: { id: "pi_expanded" } as Stripe.PaymentIntent,
      }),
    );
    expect(
      (grantMock.mock.calls[0]![0] as { contributionReference: string })
        .contributionReference,
    ).toBe("pi_expanded");
  });

  it("falls back to the stored amount when the Session reports none", async () => {
    // Stripe normally sends `amount_total`; the stored figure is the backstop
    // so a grant is never recorded as costing zero.
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {
        amount_total: null,
        currency: null,
      }),
    );
    expect(grantMock.mock.calls[0]![0]).toMatchObject({
      contributionAmountMinor: 3000,
      contributionCurrency: "GBP",
    });
  });

  it("records a purchase with no attribution when the row carried none", async () => {
    // An organic buyer who arrived at /founding directly: no campaign, no
    // code, no click ids. The conversion still counts.
    checkoutMocks.claimForCompletion.mockResolvedValue({
      ...CLAIMED,
      referralCode: null,
      campaignSlug: null,
      eventId: null,
      fbp: null,
      fbc: null,
      marketingConsent: false,
    });
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {}),
    );
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "purchase",
      source: "web",
      eventId: `founding-purchase:${CLAIMED.id}`,
      properties: {
        marketing_consent: false,
        value: 30,
        currency: "GBP",
        tier: "premium",
        months: 6,
      },
    });
  });

  it("carries the Meta click id when the browser had one", async () => {
    checkoutMocks.claimForCompletion.mockResolvedValue({
      ...CLAIMED,
      fbc: "fb.1.1.click",
    });
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", {}),
    );
    expect(
      (emitEventMock.mock.calls[0]![0] as { properties: { fbc?: string } })
        .properties.fbc,
    ).toBe("fb.1.1.click");
  });

  it("records no payment reference when the Session carries no intent", async () => {
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", { payment_intent: null }),
    );
    expect(grantMock.mock.calls[0]![0]).toMatchObject({
      contributionReference: null,
    });
  });

  it("alerts rather than throwing when the grant link cannot be written", async () => {
    // A throw here 500s the webhook; the redelivery finds the row already
    // completed and returns quietly, so the grant would exist with no
    // `grant_id`, no conversion event, and nothing saying so.
    checkoutMocks.attachGrant.mockRejectedValue(new Error("pool exhausted"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      handleCheckoutSessionCompleted(event("checkout.session.completed", {})),
    ).resolves.toBeUndefined();
    const lines = (
      console.error as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("attach_grant_failed"))).toBe(true);
    // The conversion is still recorded — the grant itself succeeded.
    expect(emitEventMock).toHaveBeenCalled();
  });

  it("alerts when a completion carries no payment reference", async () => {
    // Without one, `findLiveByPaymentReference` cannot match it and a later
    // refund leaves access in place after the money has gone back.
    vi.spyOn(console, "error").mockImplementation(() => {});
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", { payment_intent: null }),
    );
    const lines = (
      console.error as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("no_payment_reference"))).toBe(true);
  });

  describe("idempotency", () => {
    it("grants nothing when the row is no longer open", async () => {
      // Webhook delivery is at-least-once; the conditional claim is what stops
      // a redelivery creating a second grant for one payment.
      checkoutMocks.claimForCompletion.mockResolvedValue(null);
      await handleCheckoutSessionCompleted(
        event("checkout.session.completed", {}),
      );
      expect(grantMock).not.toHaveBeenCalled();
      expect(emitEventMock).not.toHaveBeenCalled();
    });

    it("ignores a Checkout Session that is not one of ours", async () => {
      checkoutMocks.claimForCompletion.mockResolvedValue(null);
      await handleCheckoutSessionCompleted(
        event("checkout.session.completed", { id: "cs_someone_else" }),
      );
      expect(grantMock).not.toHaveBeenCalled();
    });
  });

  it("does nothing until the payment is actually paid", async () => {
    // Async payment methods complete later; an unpaid completion is not a sale.
    await handleCheckoutSessionCompleted(
      event("checkout.session.completed", { payment_status: "unpaid" }),
    );
    expect(checkoutMocks.claimForCompletion).not.toHaveBeenCalled();
    expect(grantMock).not.toHaveBeenCalled();
  });

  describe("when access cannot be granted", () => {
    beforeEach(() => {
      grantMock.mockResolvedValue({
        ok: false,
        error: {
          code: "active_store_subscription",
          subscription: { tierName: "premium", expiresAt: null },
        },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("leaves the session completed and flags it, rather than retrying", async () => {
      // Retrying could never help — the store subscription will still be there
      // — and throwing would have Stripe redeliver for days.
      await expect(
        handleCheckoutSessionCompleted(event("checkout.session.completed", {})),
      ).resolves.toBeUndefined();
      expect(auditMock).toHaveBeenCalledTimes(1);
      expect(auditMock.mock.calls[0]![0]).toMatchObject({
        action: "founding_checkout.needs_review",
        entityType: "founding_checkout_session",
        entityId: "checkout-row-1",
      });
    });

    it("alerts and emails so a paid customer is not left silently unserved", async () => {
      await handleCheckoutSessionCompleted(
        event("checkout.session.completed", {}),
      );
      const line = String(
        (console.error as unknown as { mock: { calls: unknown[][] } }).mock
          .calls[0]?.[0],
      );
      expect(line).toContain("founding_checkout.needs_review");
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const mail = sendEmailMock.mock.calls[0]![0] as {
        text: string;
        html: string;
      };
      expect(mail.html).toContain("Founding checkout needs review");
      expect(mail.text).toContain("buyer@example.test");
      expect(mail.text).toContain("active_store_subscription");
    });

    it("does not record a conversion for access nobody got", async () => {
      await handleCheckoutSessionCompleted(
        event("checkout.session.completed", {}),
      );
      expect(emitEventMock).not.toHaveBeenCalled();
      expect(checkoutMocks.attachGrant).not.toHaveBeenCalled();
    });

    it("still alerts and emails when the audit write itself fails", async () => {
      // The likeliest trigger for this whole path is the database, and the
      // audit row uses the same pool the failed grant did. An unguarded write
      // would fail for the same reason and take the email with it, leaving one
      // log line as the entire trail.
      auditMock.mockRejectedValueOnce(new Error("pool exhausted"));
      await expect(
        handleCheckoutSessionCompleted(event("checkout.session.completed", {})),
      ).resolves.toBeUndefined();
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
    });

    it("still succeeds when the notification email fails", async () => {
      // The audit row is the durable record; a Resend outage must not make
      // Stripe retry a payment we have already accepted.
      sendEmailMock.mockRejectedValueOnce(new Error("Resend down"));
      await expect(
        handleCheckoutSessionCompleted(event("checkout.session.completed", {})),
      ).resolves.toBeUndefined();
      expect(auditMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("a referral that cannot be claimed", () => {
    beforeEach(() => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it.each(["invalid_referral_code", "referral_locked_elsewhere"])(
      "grants anyway without the code when the grant is refused for %s",
      async (code) => {
        // Attribution yields to access: a stale `?ref=`, or a buyer already
        // locked to another partner's code, must not cost them the thing they
        // have paid for.
        grantMock
          .mockResolvedValueOnce({ ok: false, error: { code } })
          .mockResolvedValueOnce({
            ok: true,
            result: { grantId: "grant-1", status: "pending" },
          });
        await handleCheckoutSessionCompleted(
          event("checkout.session.completed", {}),
        );
        expect(grantMock).toHaveBeenCalledTimes(2);
        expect(grantMock.mock.calls[1]![0]).toMatchObject({
          referralCode: null,
          email: "buyer@example.test",
        });
        expect(checkoutMocks.attachGrant).toHaveBeenCalledWith(
          "checkout-row-1",
          "grant-1",
        );
        expect(auditMock).not.toHaveBeenCalled();
      },
    );

    it("records that the attribution was dropped rather than losing it silently", async () => {
      grantMock
        .mockResolvedValueOnce({
          ok: false,
          error: { code: "invalid_referral_code" },
        })
        .mockResolvedValueOnce({
          ok: true,
          result: { grantId: "grant-1", status: "pending" },
        });
      await handleCheckoutSessionCompleted(
        event("checkout.session.completed", {}),
      );
      const lines = (
        console.warn as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("referral_dropped"))).toBe(true);
    });

    it("flags it for review when the retry itself throws", async () => {
      // The row is already `completed`, so a throw on the second attempt loses
      // the payment just as surely as one on the first.
      grantMock
        .mockResolvedValueOnce({
          ok: false,
          error: { code: "invalid_referral_code" },
        })
        .mockRejectedValueOnce(new Error("connection terminated"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        handleCheckoutSessionCompleted(event("checkout.session.completed", {})),
      ).rejects.toThrow("connection terminated");
      expect(auditMock).toHaveBeenCalledTimes(1);
      expect(
        String((auditMock.mock.calls[0]![0] as { reason: string }).reason),
      ).toContain("grant_threw");
    });

    it("still flags a retry that is refused for a different reason", async () => {
      grantMock
        .mockResolvedValueOnce({
          ok: false,
          error: { code: "invalid_referral_code" },
        })
        .mockResolvedValueOnce({ ok: false, error: { code: "pool_full" } });
      vi.spyOn(console, "error").mockImplementation(() => {});
      await handleCheckoutSessionCompleted(
        event("checkout.session.completed", {}),
      );
      expect(auditMock).toHaveBeenCalledTimes(1);
      expect(emitEventMock).not.toHaveBeenCalled();
    });

    it("stops crediting the code it could not honour", async () => {
      grantMock
        .mockResolvedValueOnce({
          ok: false,
          error: { code: "invalid_referral_code" },
        })
        .mockResolvedValueOnce({
          ok: true,
          result: { grantId: "grant-1", status: "pending" },
        });
      await handleCheckoutSessionCompleted(
        event("checkout.session.completed", {}),
      );
      expect(checkoutMocks.clearReferral).toHaveBeenCalledWith(
        "checkout-row-1",
      );
      // …and the conversion event must not credit it either.
      const props = (
        emitEventMock.mock.calls[0]![0] as {
          properties: Record<string, unknown>;
        }
      ).properties;
      expect(props).not.toHaveProperty("ref");
    });

    it("does not retry a refusal that has nothing to do with the referral", async () => {
      grantMock.mockResolvedValue({
        ok: false,
        error: { code: "duplicate" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      await handleCheckoutSessionCompleted(
        event("checkout.session.completed", {}),
      );
      expect(grantMock).toHaveBeenCalledTimes(1);
      expect(auditMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when granting THROWS rather than refusing", () => {
    beforeEach(() => {
      grantMock.mockRejectedValue(new Error("connection terminated"));
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("flags it for review before letting the error out", async () => {
      // The claim has already flipped the row to `completed`, so the retry's
      // claim finds nothing open and returns quietly — payment taken, no
      // grant, and without this nothing at all recording that it happened.
      await expect(
        handleCheckoutSessionCompleted(event("checkout.session.completed", {})),
      ).rejects.toThrow("connection terminated");
      expect(auditMock).toHaveBeenCalledTimes(1);
      expect(auditMock.mock.calls[0]![0]).toMatchObject({
        action: "founding_checkout.needs_review",
        entityId: "checkout-row-1",
      });
      expect(
        String((auditMock.mock.calls[0]![0] as { reason: string }).reason),
      ).toContain("grant_threw");
    });

    it("alerts and emails, then rethrows so Stripe still retries", async () => {
      await expect(
        handleCheckoutSessionCompleted(event("checkout.session.completed", {})),
      ).rejects.toThrow();
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const line = String(
        (console.error as unknown as { mock: { calls: unknown[][] } }).mock
          .calls[0]?.[0],
      );
      expect(line).toContain("founding_checkout.needs_review");
    });

    it("records no conversion for a grant that did not happen", async () => {
      await expect(
        handleCheckoutSessionCompleted(event("checkout.session.completed", {})),
      ).rejects.toThrow();
      expect(emitEventMock).not.toHaveBeenCalled();
      expect(checkoutMocks.attachGrant).not.toHaveBeenCalled();
    });
  });
});

describe("handleCheckoutSessionExpired", () => {
  beforeEach(() => vi.clearAllMocks());

  it("releases the seat the abandoned checkout was holding", async () => {
    await handleCheckoutSessionExpired(event("checkout.session.expired", {}));
    expect(checkoutMocks.markExpired).toHaveBeenCalledWith("cs_test_1");
  });

  it("is harmless when the session is not one of ours", async () => {
    checkoutMocks.markExpired.mockResolvedValue(false);
    await expect(
      handleCheckoutSessionExpired(event("checkout.session.expired", {})),
    ).resolves.toBeUndefined();
  });
});
