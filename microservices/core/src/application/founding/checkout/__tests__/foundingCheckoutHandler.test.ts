import { beforeEach, describe, expect, it, vi } from "vitest";

const stripeMocks = vi.hoisted(() => ({
  create: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  retrieve: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  expire: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
}));
vi.mock("../../../stripe/stripeClient", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: stripeMocks.create,
        retrieve: stripeMocks.retrieve,
        expire: stripeMocks.expire,
      },
    },
  }),
}));

const priceMocks = vi.hoisted(() => ({
  resolveFoundingPrice: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("../foundingPrices", () => ({
  resolveFoundingPrice: (...args: unknown[]) =>
    priceMocks.resolveFoundingPrice(...args),
}));

const referralMocks = vi.hoisted(() => ({
  findCodeByCanonical: vi.fn<(...args: unknown[]) => Promise<unknown>>(
    async () => ({ id: "code-1" }),
  ),
}));
vi.mock("../../../repositories/referralRepository", () => ({
  ReferralRepository: class {
    findCodeByCanonical = referralMocks.findCodeByCanonical;
  },
}));

const emitEventMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
);
vi.mock("../../../analytics/emitEvent", () => ({ emitEvent: emitEventMock }));

const turnstileMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string>>(async () => "passed"),
);
vi.mock("../../../leads/turnstile", () => ({ verifyTurnstile: turnstileMock }));

const repoMocks = vi.hoisted(() => ({
  reserveSeatUnderPoolLock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  hasLiveOrPendingGrantForEmail: vi.fn<
    (...args: unknown[]) => Promise<boolean>
  >(async () => false),
  countHeldInPool: vi.fn<(...args: unknown[]) => Promise<number>>(
    async () => 0,
  ),
  countOpenHoldsForEmail: vi.fn<(...args: unknown[]) => Promise<number>>(
    async () => 0,
  ),
  reserveIn: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    id: "reservation-1",
  })),
  attachStripeSession: vi.fn<(...args: unknown[]) => Promise<void>>(
    async () => {},
  ),
  releaseReservation: vi.fn<(...args: unknown[]) => Promise<void>>(
    async () => {},
  ),
  findOpenHoldForEmail: vi.fn<(...args: unknown[]) => Promise<unknown>>(
    async () => null,
  ),
  findByStripeSessionId: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("../../../repositories/foundingGrantRepository", () => ({
  FoundingGrantRepository: class {
    reserveSeatUnderPoolLock = repoMocks.reserveSeatUnderPoolLock;
    hasLiveOrPendingGrantForEmail = repoMocks.hasLiveOrPendingGrantForEmail;
  },
}));
vi.mock("../../../repositories/foundingCheckoutRepository", () => ({
  FoundingCheckoutRepository: class {
    countHeldInPool = repoMocks.countHeldInPool;
    countOpenHoldsForEmail = repoMocks.countOpenHoldsForEmail;
    reserveIn = repoMocks.reserveIn;
    attachStripeSession = repoMocks.attachStripeSession;
    releaseReservation = repoMocks.releaseReservation;
    findOpenHoldForEmail = repoMocks.findOpenHoldForEmail;
    findByStripeSessionId = repoMocks.findByStripeSessionId;
  },
}));

import { resetRateLimits } from "../../../leads/rateLimit";
import {
  CHECKOUT_TERMS,
  foundingCheckoutHandler,
  maskEmail,
} from "../foundingCheckoutHandler";
import { FOUNDING_OFFER_CLOSES } from "../../foundingOffer";

interface Handler {
  handle: (request: Request) => Promise<Response>;
}

const VALID = {
  tier: "premium",
  months: 6,
  email: "  Buyer@Example.TEST  ",
  referralCode: "meta-found",
  campaign: "meta",
  marketing_consent: true,
  event_id: "evt-checkout-1",
  fbp: "fb.1.1.xyz",
};

function post(body: unknown, ip = "203.0.113.5"): Promise<Response> {
  return (foundingCheckoutHandler as unknown as Handler).handle(
    new Request("http://localhost/founding/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

function status(sessionId: string, ip = "203.0.113.6"): Promise<Response> {
  return (foundingCheckoutHandler as unknown as Handler).handle(
    new Request(`http://localhost/founding/checkout/${sessionId}/status`, {
      headers: { "x-forwarded-for": ip },
    }),
  );
}

describe("POST /founding/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    vi.useRealTimers();
    vi.stubEnv("WEB_ORIGIN", "https://example.test");
    turnstileMock.mockResolvedValue("passed");
    // Explicit, not inherited from the `vi.fn(default)` argument: a test that
    // overrides one of these with `mockResolvedValue` replaces the
    // implementation, and `clearAllMocks` only clears CALLS.
    repoMocks.hasLiveOrPendingGrantForEmail.mockResolvedValue(false);
    repoMocks.countHeldInPool.mockResolvedValue(0);
    repoMocks.countOpenHoldsForEmail.mockResolvedValue(0);
    repoMocks.reserveIn.mockResolvedValue({ id: "reservation-1" });
    repoMocks.attachStripeSession.mockResolvedValue(undefined);
    repoMocks.releaseReservation.mockResolvedValue(undefined);
    repoMocks.findOpenHoldForEmail.mockResolvedValue(null);
    stripeMocks.expire.mockResolvedValue({});
    referralMocks.findCodeByCanonical.mockResolvedValue({ id: "code-1" });
    priceMocks.resolveFoundingPrice.mockImplementation(
      async (tier: unknown, months: unknown) => ({
        ok: true,
        priceId: `price_${String(tier)}_${String(months)}`,
      }),
    );
    // Runs the caller's own `decide` so the reservation the route builds is
    // the thing under test, not a stub of it.
    repoMocks.reserveSeatUnderPoolLock.mockImplementation(
      async (_pool, decide) => {
        const decision = await (
          decide as (
            tx: unknown,
          ) => Promise<
            { held: number; reserve: () => Promise<unknown> } | string
          >
        )({});
        return typeof decision === "string" ? decision : decision.reserve();
      },
    );
    stripeMocks.create.mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      amount_total: 3000,
      currency: "gbp",
      expires_at: Math.floor(Date.now() / 1000) + 1860,
    });
  });

  it("returns the Stripe url and records the checkout", async () => {
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    expect(repoMocks.reserveIn).toHaveBeenCalledTimes(1);
    expect(repoMocks.reserveIn.mock.calls[0]![1]).toMatchObject({
      email: "buyer@example.test",
      tierName: "premium",
      months: 6,
      referralCode: "METAFOUND",
      campaignSlug: "meta",
      marketingConsent: true,
    });
    // The seat was held before Stripe answered; this binds it to the Session.
    expect(repoMocks.attachStripeSession.mock.calls[0]!.slice(0, 4)).toEqual([
      "reservation-1",
      "cs_test_1",
      3000,
      "GBP",
    ]);
  });

  it("takes the amount from the Session, never from anything local", async () => {
    // Stripe's Price is the authority on what a buyer is charged. Storing a
    // figure of our own would let the record drift from the bank.
    stripeMocks.create.mockResolvedValue({
      id: "cs_test_2",
      url: "https://checkout.stripe.com/c/pay/cs_test_2",
      amount_total: 2500,
      currency: "usd",
    });
    await post(VALID);
    expect(repoMocks.attachStripeSession.mock.calls[0]!.slice(0, 4)).toEqual([
      "reservation-1",
      "cs_test_2",
      2500,
      "USD",
    ]);
  });

  it("builds a one-off payment Session, not a subscription", async () => {
    await post(VALID);
    const args = stripeMocks.create.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(args.mode).toBe("payment");
    expect(args.line_items).toEqual([
      { price: "price_premium_6", quantity: 1 },
    ]);
  });

  it("fixes the email server-side so it cannot be edited on Stripe's page", async () => {
    // The address is what the grant, its invite and the seat hold are keyed on.
    await post(VALID);
    const args = stripeMocks.create.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(args.customer_email).toBe("buyer@example.test");
  });

  it("carries the attribution through Stripe in metadata", async () => {
    await post(VALID);
    const args = stripeMocks.create.mock.calls[0]![0] as {
      metadata: Record<string, string>;
    };
    expect(args.metadata).toEqual({
      tier: "premium",
      months: "6",
      email: "buyer@example.test",
      referral_code: "METAFOUND",
      campaign_slug: "meta",
    });
  });

  it("expires the Session a little AFTER the local hold, never before", async () => {
    // Stripe's minimum is 30 minutes from when IT evaluates the request, which
    // is later than any stamp chosen before the pool transaction ran — one
    // fixed earlier and floored is routinely a second short and the whole call
    // is rejected. Headroom, and rounded up.
    const now = new Date("2026-09-10T10:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await post(VALID);
    const args = stripeMocks.create.mock.calls[0]![0] as { expires_at: number };
    const hold = (
      repoMocks.reserveIn.mock.calls[0]![1] as { holdExpiresAt: Date }
    ).holdExpiresAt;
    expect(hold).toEqual(new Date(now.getTime() + 30 * 60 * 1000));
    expect(args.expires_at * 1000).toBeGreaterThanOrEqual(hold.getTime());
    vi.useRealTimers();
  });

  it("requires terms acceptance and states the cancellation position", async () => {
    const args = await post(VALID).then(
      () => stripeMocks.create.mock.calls[0]![0] as Record<string, never>,
    );
    expect(args.consent_collection).toEqual({ terms_of_service: "required" });
    expect(JSON.stringify(args.custom_text)).toContain(CHECKOUT_TERMS);
  });

  it("ticks the buyer into the SAME cancellation position the page sold them", () => {
    // LANDING_PAGE.md § 5.7, and it must agree with `FOUNDING_COPY.termsNote`
    // (§ 5.6) on the page that sent the buyer here. The two strings live in
    // different packages and cannot import each other, so each is pinned to
    // the doc; this is the half that forms the contract.
    //
    // The earlier assertion was /immediate supply|14-day/i, which matched the
    // old placeholder saying the buyer LOSES the right and would equally have
    // matched anything else mentioning "14-day".
    expect(CHECKOUT_TERMS).toBe(
      "I agree to the Persistence terms and ask for my access to start when I sign up. I understand I can cancel within 14 days for a full refund unless I've started using the app.",
    );
  });

  it.each([
    ["premium", 6],
    ["premium", 12],
    ["premium_plus", 6],
    ["premium_plus", 12],
  ])(
    "resolves the %s/%im Price and builds the Session from it",
    async (tier, months) => {
      await post({ ...VALID, tier, months });
      expect(priceMocks.resolveFoundingPrice).toHaveBeenCalledWith(
        tier,
        months,
      );
      const args = stripeMocks.create.mock.calls[0]![0] as {
        line_items: Array<{ price: string }>;
      };
      expect(args.line_items[0]!.price).toBe(`price_${tier}_${months}`);
    },
  );

  it("emits checkout_started as intent, with the value and the attribution", async () => {
    await post(VALID);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "checkout_started",
      source: "web",
      eventId: "evt-checkout-1",
      properties: {
        marketing_consent: true,
        tier: "premium",
        months: 6,
        value: 30,
        currency: "GBP",
        fbp: "fb.1.1.xyz",
        campaign: "meta",
        ref: "METAFOUND",
      },
    });
  });

  describe("refusals", () => {
    it("refuses when the pool is full, before touching Stripe", async () => {
      repoMocks.reserveSeatUnderPoolLock.mockResolvedValue("pool_full");
      const res = await post(VALID);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ ok: false, error: "pool_full" });
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("takes the seat inside the pool lock, before Stripe is called", async () => {
      // Checking capacity, releasing the lock and only then recording the hold
      // is check-then-act: two buyers a few hundred milliseconds apart both
      // see the last seat free and both pay for it.
      await post(VALID);
      expect(repoMocks.reserveIn).toHaveBeenCalledTimes(1);
      const reserveOrder = repoMocks.reserveIn.mock.invocationCallOrder[0] ?? 0;
      const stripeOrder = stripeMocks.create.mock.invocationCallOrder[0] ?? 0;
      expect(reserveOrder).toBeLessThan(stripeOrder);
    });

    it("sends an abandoned checkout back to the Stripe page it already has", async () => {
      // Cancelling on Stripe's page does NOT expire the Session, so the hold
      // survives. Refusing would lock a buyer out for half an hour for
      // changing their mind — a mainstream checkout path turned into a lost
      // sale.
      repoMocks.findOpenHoldForEmail.mockResolvedValue({
        id: "reservation-old",
        stripeSessionId: "cs_old",
        tierName: "premium",
        months: 6,
      });
      stripeMocks.retrieve.mockResolvedValue({
        status: "open",
        url: "https://checkout.stripe.com/c/pay/cs_old",
      });
      const res = await post(VALID);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        url: "https://checkout.stripe.com/c/pay/cs_old",
      });
      // No second seat taken, no second Session created.
      expect(repoMocks.reserveIn).not.toHaveBeenCalled();
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("starts fresh only once Stripe says the old session is dead", async () => {
      repoMocks.findOpenHoldForEmail.mockResolvedValue({
        id: "reservation-old",
        stripeSessionId: "cs_old",
        tierName: "premium",
        months: 6,
      });
      stripeMocks.retrieve.mockResolvedValue({ status: "expired", url: null });
      const res = await post(VALID);
      expect(res.status).toBe(200);
      expect(repoMocks.releaseReservation).toHaveBeenCalledWith(
        "reservation-old",
      );
      expect(stripeMocks.create).toHaveBeenCalledTimes(1);
    });

    it("REFUSES rather than releasing when Stripe cannot be asked", async () => {
      // A failed lookup and a dead session are indistinguishable. Releasing
      // would free a seat whose Stripe page is still payable, and a payment on
      // it would then find no open row to claim — money taken, no grant, no
      // alert.
      repoMocks.findOpenHoldForEmail.mockResolvedValue({
        id: "reservation-old",
        stripeSessionId: "cs_old",
        tierName: "premium",
        months: 6,
      });
      stripeMocks.retrieve.mockRejectedValue(new Error("API down"));
      const res = await post(VALID);
      expect(res.status).toBe(429);
      expect(repoMocks.releaseReservation).not.toHaveBeenCalled();
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("sends a buyer whose payment is already through to the thanks page", async () => {
      // Paid, webhook not yet landed. Releasing the seat would orphan that
      // payment.
      repoMocks.findOpenHoldForEmail.mockResolvedValue({
        id: "reservation-old",
        stripeSessionId: "cs_old",
        tierName: "premium",
        months: 6,
      });
      stripeMocks.retrieve.mockResolvedValue({ status: "complete", url: null });
      const res = await post(VALID);
      expect(await res.json()).toEqual({
        ok: true,
        url: "https://example.test/founding/thanks?session_id=cs_old",
      });
      expect(repoMocks.releaseReservation).not.toHaveBeenCalled();
    });

    it("expires the old session at Stripe before selling a different term", async () => {
      // Sending them back to a live Session for the plan they abandoned would
      // grant the wrong tier; releasing without killing it leaves it payable.
      repoMocks.findOpenHoldForEmail.mockResolvedValue({
        id: "reservation-old",
        stripeSessionId: "cs_old",
        tierName: "premium",
        months: 6,
      });
      stripeMocks.retrieve.mockResolvedValue({
        status: "open",
        url: "https://checkout.stripe.com/c/pay/cs_old",
      });
      const res = await post({ ...VALID, tier: "premium_plus", months: 12 });
      expect(res.status).toBe(200);
      expect(stripeMocks.expire).toHaveBeenCalledWith("cs_old");
      expect(repoMocks.releaseReservation).toHaveBeenCalledWith(
        "reservation-old",
      );
      expect(stripeMocks.create).toHaveBeenCalledTimes(1);
    });

    it("keeps the seat when the old session cannot be expired", async () => {
      repoMocks.findOpenHoldForEmail.mockResolvedValue({
        id: "reservation-old",
        stripeSessionId: "cs_old",
        tierName: "premium",
        months: 6,
      });
      stripeMocks.retrieve.mockResolvedValue({
        status: "open",
        url: "https://checkout.stripe.com/c/pay/cs_old",
      });
      stripeMocks.expire.mockRejectedValue(new Error("cannot expire"));
      const res = await post({ ...VALID, tier: "premium_plus", months: 12 });
      expect(res.status).toBe(429);
      expect(repoMocks.releaseReservation).not.toHaveBeenCalled();
    });

    it("clears a reservation whose Stripe call never completed", async () => {
      // The Lambda died between reserving and creating the Session. There is
      // nothing to orphan, and leaving it locks the address out for half an
      // hour over a seat holding nothing.
      repoMocks.findOpenHoldForEmail.mockResolvedValue({
        id: "reservation-orphan",
        stripeSessionId: "reserved_abc",
        tierName: "premium",
        months: 6,
      });
      const res = await post(VALID);
      expect(res.status).toBe(200);
      expect(stripeMocks.retrieve).not.toHaveBeenCalled();
      expect(repoMocks.releaseReservation).toHaveBeenCalledWith(
        "reservation-orphan",
      );
      expect(stripeMocks.create).toHaveBeenCalledTimes(1);
    });

    it("refuses a second concurrent hold from the same address", async () => {
      // A hold costs nothing and takes a pool place for half an hour.
      repoMocks.countOpenHoldsForEmail.mockResolvedValue(1);
      const res = await post(VALID);
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ ok: false, error: "too_many_holds" });
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("refuses somebody who already holds a place, before they pay", async () => {
      // The grant service would refuse the duplicate AFTER the money was
      // taken, leaving a manual refund.
      repoMocks.hasLiveOrPendingGrantForEmail.mockResolvedValue(true);
      const res = await post(VALID);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ ok: false, error: "already_granted" });
      expect(repoMocks.reserveIn).not.toHaveBeenCalled();
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("refuses when no bot challenge is configured", async () => {
      // Fail-open is right for a form that only sends an email. This route
      // takes a capped place for free, so an unguarded stage would let a
      // script empty the pool without paying.
      turnstileMock.mockResolvedValue("skipped");
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await post(VALID);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: "not_configured" });
      expect(repoMocks.reserveIn).not.toHaveBeenCalled();
    });

    it("refuses after the offer closes, with 410", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(FOUNDING_OFFER_CLOSES.getTime() + 1000));
      const res = await post(VALID);
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ ok: false, error: "offer_closed" });
      expect(stripeMocks.create).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("still sells on the last second before the close", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(FOUNDING_OFFER_CLOSES);
      expect((await post(VALID)).status).toBe(200);
      vi.useRealTimers();
    });

    it("503s when the Price cannot be resolved or verified", async () => {
      // The buyer did nothing wrong, so this is not a 400. And it refuses
      // rather than creating a Session with a Price we could not vouch for —
      // that would charge somebody the wrong amount.
      priceMocks.resolveFoundingPrice.mockResolvedValue({
        ok: false,
        reason: "unavailable",
      });
      const res = await post(VALID);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        ok: false,
        error: "founding_prices_unavailable",
      });
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("503s and stores nothing when Stripe itself fails", async () => {
      stripeMocks.create.mockRejectedValue(new Error("Stripe down"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await post(VALID);
      expect(res.status).toBe(503);
      // The seat goes straight back rather than making the next buyer wait
      // half an hour for a hold nobody is using.
      expect(repoMocks.releaseReservation).toHaveBeenCalledWith(
        "reservation-1",
      );
      expect(repoMocks.attachStripeSession).not.toHaveBeenCalled();
    });

    it("503s when Stripe returns a Session with no url to send anyone to", async () => {
      stripeMocks.create.mockResolvedValue({ id: "cs_x", amount_total: 3000 });
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await post(VALID)).status).toBe(503);
      expect(repoMocks.releaseReservation).toHaveBeenCalledWith(
        "reservation-1",
      );
      expect(repoMocks.attachStripeSession).not.toHaveBeenCalled();
    });

    it("refuses an invalid email", async () => {
      const res = await post({ ...VALID, email: "not-an-email" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_email" });
    });

    it("refuses the coach tier — it is not sold on the web", async () => {
      const res = await post({ ...VALID, tier: "start_up_coach_plus" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_tier" });
    });

    it("refuses a term that is not on sale", async () => {
      const res = await post({ ...VALID, months: 3 });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_months" });
    });

    it("refuses a failed Turnstile challenge before reserving anything", async () => {
      turnstileMock.mockResolvedValue("failed");
      const res = await post(VALID);
      expect(res.status).toBe(400);
      expect(repoMocks.reserveIn).not.toHaveBeenCalled();
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("answers a filled honeypot like a success and does nothing", async () => {
      const res = await post({ ...VALID, hp: "bot" });
      expect(res.status).toBe(200);
      expect(stripeMocks.create).not.toHaveBeenCalled();
      expect(repoMocks.reserveIn).not.toHaveBeenCalled();
      expect(emitEventMock).not.toHaveBeenCalled();
    });

    it("rate-limits a naive script on the shared leads budget", async () => {
      const ip = "198.51.100.9";
      for (let i = 0; i < 10; i += 1) {
        expect((await post(VALID, ip)).status).toBe(200);
      }
      expect((await post(VALID, ip)).status).toBe(429);
    });
  });

  describe("attribution that cannot be trusted is dropped, not rejected", () => {
    it("keeps the sale but drops a malformed referral code", async () => {
      // A code changes neither price nor entitlement, so a typo must not cost
      // a purchase.
      const res = await post({ ...VALID, referralCode: "!!" });
      expect(res.status).toBe(200);
      expect(repoMocks.reserveIn.mock.calls[0]![1]).toMatchObject({
        referralCode: null,
      });
    });

    it("keeps the sale but drops a code that does not exist", async () => {
      // A well-formed code that no longer resolves is refused by the grant
      // service in the WEBHOOK, after the card is charged. Attribution never
      // changes price or entitlement, so it must never cost somebody the thing
      // they paid for.
      referralMocks.findCodeByCanonical.mockResolvedValue(null);
      const res = await post(VALID);
      expect(res.status).toBe(200);
      expect(repoMocks.reserveIn.mock.calls[0]![1]).toMatchObject({
        referralCode: null,
      });
    });

    it("does not look up a code that was never supplied", async () => {
      await post({ tier: "premium", months: 6, email: "b@x.test" });
      expect(referralMocks.findCodeByCanonical).not.toHaveBeenCalled();
    });

    it("keeps the sale but drops an unrecognisable campaign slug", async () => {
      const res = await post({ ...VALID, campaign: "Meta Ads!" });
      expect(res.status).toBe(200);
      expect(repoMocks.reserveIn.mock.calls[0]![1]).toMatchObject({
        campaignSlug: null,
      });
    });
  });

  it("records a bare checkout when the buyer arrived with no attribution", async () => {
    // Somebody who typed the address in: no campaign, no code, no click ids,
    // no consent. The sale still goes through and the intent still counts.
    const res = await post({ tier: "premium", months: 6, email: "b@x.test" });
    expect(res.status).toBe(200);
    expect(repoMocks.reserveIn.mock.calls[0]![1]).toMatchObject({
      referralCode: null,
      campaignSlug: null,
      eventId: null,
      fbc: null,
      fbp: null,
      marketingConsent: false,
    });
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "checkout_started",
      source: "web",
      eventId: undefined,
      properties: {
        marketing_consent: false,
        tier: "premium",
        months: 6,
        value: 30,
        currency: "GBP",
      },
    });
  });

  it("carries the Meta click id when the browser had one", async () => {
    await post({ ...VALID, fbc: "fb.1.1.click" });
    expect(repoMocks.reserveIn.mock.calls[0]![1]).toMatchObject({
      fbc: "fb.1.1.click",
    });
  });

  it("records zero rather than guessing when Stripe reports no total", async () => {
    stripeMocks.create.mockResolvedValue({
      id: "cs_no_total",
      url: "https://checkout.stripe.com/c/pay/cs_no_total",
    });
    await post(VALID);
    expect(repoMocks.attachStripeSession.mock.calls[0]!.slice(0, 4)).toEqual([
      "reservation-1",
      "cs_no_total",
      0,
      "GBP",
    ]);
  });

  it("sends the buyer back to the configured web origin", async () => {
    await post(VALID);
    const args = stripeMocks.create.mock.calls[0]![0] as {
      success_url: string;
      cancel_url: string;
    };
    expect(args.success_url).toBe(
      "https://example.test/founding/thanks?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(args.cancel_url).toBe("https://example.test/founding?cancelled=1");
  });

  it("falls back to the production site when no origin is configured", async () => {
    // A dev stage still has to send a buyer somewhere that exists.
    vi.stubEnv("WEB_ORIGIN", "");
    await post(VALID);
    const args = stripeMocks.create.mock.calls[0]![0] as {
      success_url: string;
    };
    expect(args.success_url).toContain(
      "https://persistence.evans-software-solutions.com",
    );
  });

  it("holds the seat for at least as long as the Stripe page is payable", async () => {
    // A hold that lapses first leaves a live Stripe page for a seat somebody
    // else can now be given — the oversell the hold exists to prevent.
    const expiresAt = Math.floor(Date.now() / 1000) + 1860;
    stripeMocks.create.mockResolvedValue({
      id: "cs_exp",
      url: "https://checkout.stripe.com/c/pay/cs_exp",
      amount_total: 3000,
      currency: "gbp",
      expires_at: expiresAt,
    });
    await post(VALID);
    const [, , , , hold] = repoMocks.attachStripeSession.mock.calls[0]!;
    expect(hold).toEqual(new Date(expiresAt * 1000));
    const reserved = (
      repoMocks.reserveIn.mock.calls[0]![1] as { holdExpiresAt: Date }
    ).holdExpiresAt;
    expect((hold as Date).getTime()).toBeGreaterThanOrEqual(reserved.getTime());
  });

  it("keeps the reserved expiry when Stripe reports none", async () => {
    stripeMocks.create.mockResolvedValue({
      id: "cs_noexp",
      url: "https://checkout.stripe.com/c/pay/cs_noexp",
      amount_total: 3000,
      currency: "gbp",
    });
    await post(VALID);
    const [, , , , hold] = repoMocks.attachStripeSession.mock.calls[0]!;
    expect(hold).toBeInstanceOf(Date);
  });

  it("stamps CORS on the response the browser has to read", async () => {
    const res = await post(VALID);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers the preflight", async () => {
    const res = await (foundingCheckoutHandler as unknown as Handler).handle(
      new Request("http://localhost/founding/checkout", { method: "OPTIONS" }),
    );
    expect(res.status).toBe(204);
  });
});

describe("maskEmail", () => {
  it("keeps a short prefix of the name and of the domain", () => {
    expect(maskEmail("buyer@example.test")).toBe("bu•••@ex•••••.test");
  });

  it.each(["a@example.test", "jo@company.com", "abc@company.com"])(
    "never prints the whole local part of %s",
    (input) => {
      // A fixed two-character prefix would print `jo@…` in full — no masking
      // at all for exactly the short addresses most likely to be a name.
      const local = input.split("@")[0]!;
      const masked = maskEmail(input).split("@")[0]!;
      expect(masked).not.toBe(local);
      expect(masked).toContain("•");
    },
  );

  it("masks the domain but keeps its public suffix", () => {
    // A rare domain identifies somebody nearly as well as their name does.
    const masked = maskEmail("someone@a-very-small-company.co.uk");
    expect(masked.startsWith("som••••@a-•")).toBe(true);
    expect(masked.endsWith(".uk")).toBe(true);
    expect(masked).not.toContain("small-company");
  });

  it("copes with an address carrying no domain at all", () => {
    expect(() => maskEmail("nodomain")).not.toThrow();
  });
});

describe("GET /founding/checkout/:id/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    repoMocks.findByStripeSessionId.mockResolvedValue({
      status: "completed",
      tierName: "premium",
      months: 6,
      email: "buyer@example.test",
      eventId: "evt-checkout-1",
      amountMinor: 3000,
      currency: "GBP",
      holdExpiresAt: new Date("2026-09-10T10:30:00Z"),
    });
  });

  it("never returns the whole address", async () => {
    // The id travels in a URL, so anyone holding that link must not learn who
    // bought it.
    const res = await status("cs_test_1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.emailMasked).toBe("bu•••@ex•••••.test");
    expect(JSON.stringify(body)).not.toContain("buyer@example.test");
  });

  it("returns the tier and term the browser Purchase needs to name the plan", async () => {
    // The thanks page derives Meta's `content_name`/`content_ids` from these
    // two, and the server derives the SAME id for its own copy of the purchase.
    // Drop them from this response and the browser copy loses the plan while
    // the server copy keeps it — one sale, two different reported terms.
    const body = (await (await status("cs_test_1")).json()) as {
      data: { tier: string; months: number };
    };
    expect(body.data.tier).toBe("premium");
    expect(body.data.months).toBe(6);
  });

  it("returns the server's event id so the browser Purchase dedupes", async () => {
    const body = (await (await status("cs_test_1")).json()) as {
      data: { eventId: string; status: string };
    };
    expect(body.data.eventId).toBe("evt-checkout-1");
    expect(body.data.status).toBe("completed");
  });

  it("reports when the hold lapses, so a client knows to stop polling", async () => {
    // `open` is not terminal on its own — the row only leaves it on a webhook
    // — so without this a bookmarked thanks page polls forever.
    const body = (await (await status("cs_test_1")).json()) as {
      data: { holdExpiresAt: string };
    };
    expect(body.data.holdExpiresAt).toBe("2026-09-10T10:30:00.000Z");
  });

  it("404s an unknown session", async () => {
    repoMocks.findByStripeSessionId.mockResolvedValue(null);
    expect((await status("cs_nope")).status).toBe(404);
  });

  it("rate-limits polling, generously", async () => {
    const ip = "198.51.100.44";
    for (let i = 0; i < 120; i += 1) {
      expect((await status("cs_test_1", ip)).status).toBe(200);
    }
    expect((await status("cs_test_1", ip)).status).toBe(429);
  });
});
