import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  user: vi.fn(async () => ({ sub: "00000000-0000-4000-8000-000000000012" })),
  identity: vi.fn(async () => ({
    id: "00000000-0000-4000-8000-000000000012",
    email: "member@example.test",
    emailConfirmedAt: "2026-09-01",
  })),
}));
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: authMocks.user,
}));
vi.mock("../../account/supabaseAdminClient", () => ({
  getAuthUserIdentity: authMocks.identity,
}));

const stripeMocks = vi.hoisted(() => ({
  create: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  retrieve: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("../../stripe/stripeClient", () => ({
  getStripe: () => ({
    checkout: {
      sessions: { create: stripeMocks.create, retrieve: stripeMocks.retrieve },
    },
  }),
}));

const codeMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);
vi.mock("../blcCode", () => ({
  resolveBlcPromotionCode: (...args: unknown[]) => codeMock(...args),
}));

const priceMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);
vi.mock("../blcPrices", () => ({
  resolveBlcPrice: (...args: unknown[]) => priceMock(...args),
}));

const repoMocks = vi.hoisted(() => ({
  eligibility: vi.fn<(...args: unknown[]) => Promise<string | null>>(),
  isLiveSubscription: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
}));
vi.mock("../../repositories/blcCheckoutRepository", () => ({
  BlcCheckoutRepository: class {
    eligibility = repoMocks.eligibility;
    isLiveSubscription = repoMocks.isLiveSubscription;
  },
}));

const emitEventMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
);
vi.mock("../../analytics/emitEvent", () => ({ emitEvent: emitEventMock }));

const turnstileMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string>>(async () => "passed"),
);
vi.mock("../../leads/turnstile", () => ({ verifyTurnstile: turnstileMock }));

import { resetRateLimits } from "../../leads/rateLimit";
import { blcCheckoutHandler } from "../blcCheckoutHandler";
import { BLC_CHECKOUT_TERMS } from "../blcOffer";

interface Handler {
  handle: (request: Request) => Promise<Response>;
}

const USER = "00000000-0000-4000-8000-000000000012";

const VALID = {
  tier: "premium",
  cadence: "annual",
  code: " blc-test ",
  email: "  Member@Example.TEST  ",
  tduid: "td_click_1",
  campaign: "blc-launch",
  marketing_consent: true,
  event_id: "evt-blc-1",
  fbp: "fb.1.1.xyz",
};

function post(
  path: string,
  body: unknown,
  ip = "203.0.113.5",
): Promise<Response> {
  return (blcCheckoutHandler as unknown as Handler).handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        authorization: "Bearer token",
      },
      body: JSON.stringify(body),
    }),
  );
}

const checkout = (body: unknown, ip?: string) =>
  post("/blc/checkout", body, ip);
const check = (body: unknown, ip?: string) => post("/blc/code/check", body, ip);

function status(sessionId: string, ip = "203.0.113.6"): Promise<Response> {
  return (blcCheckoutHandler as unknown as Handler).handle(
    new Request(`http://localhost/blc/checkout/${sessionId}/status`, {
      headers: { "x-forwarded-for": ip },
    }),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.stubEnv("WEB_ORIGIN", "https://example.test");
  vi.spyOn(console, "error").mockImplementation(() => {});
  authMocks.user.mockResolvedValue({ sub: USER });
  authMocks.identity.mockResolvedValue({
    id: USER,
    email: "member@example.test",
    emailConfirmedAt: "2026-09-01",
  });
  turnstileMock.mockResolvedValue("passed");
  codeMock.mockResolvedValue({ id: "promo_1", code: "BLC-TEST" });
  priceMock.mockImplementation(
    async (tier: unknown, cadence: unknown) =>
      `price_${String(tier)}_${String(cadence)}`,
  );
  repoMocks.eligibility.mockResolvedValue(null);
  repoMocks.isLiveSubscription.mockResolvedValue(false);
  stripeMocks.create.mockResolvedValue({
    id: "cs_test_1",
    url: "https://checkout.stripe.com/c/pay/cs_test_1",
    amount_total: 11199,
    currency: "gbp",
  });
});

describe("POST /blc/code/check", () => {
  it("says yes to a code the checkout will honour", async () => {
    const res = await check({ code: "BLC-TEST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(codeMock).toHaveBeenCalledWith("BLC-TEST");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers every refusal with the same invalid_code", async () => {
    codeMock.mockResolvedValue(null);
    const res = await check({ code: "NOPE" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_code" });
  });

  it("answers a filled honeypot like a bad code without asking Stripe", async () => {
    const res = await check({ code: "BLC-TEST", hp: "bot" });
    expect(res.status).toBe(400);
    expect(codeMock).not.toHaveBeenCalled();
  });

  it("503s when Stripe cannot be asked", async () => {
    codeMock.mockRejectedValue(new Error("down"));
    const res = await check({ code: "BLC-TEST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
  });

  it("rate-limits a script guessing codes, 20 a minute per IP", async () => {
    const ip = "198.51.100.20";
    for (let i = 0; i < 20; i += 1) {
      expect((await check({ code: "BLC-TEST" }, ip)).status).toBe(200);
    }
    expect((await check({ code: "BLC-TEST" }, ip)).status).toBe(429);
  });

  it("answers the preflight", async () => {
    const res = await (blcCheckoutHandler as unknown as Handler).handle(
      new Request("http://localhost/blc/code/check", { method: "OPTIONS" }),
    );
    expect(res.status).toBe(204);
  });
});

describe("POST /blc/checkout", () => {
  it("returns the Stripe url", async () => {
    const res = await checkout(VALID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("builds exactly the subscription Session the offer promises", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    await checkout(VALID);
    expect(stripeMocks.create).toHaveBeenCalledTimes(1);
    const [params, options] = stripeMocks.create.mock.calls[0]!;
    expect(params).toEqual({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: "member@example.test",
      client_reference_id: USER,
      line_items: [{ price: "price_premium_annual", quantity: 1 }],
      discounts: [{ promotion_code: "promo_1" }],
      success_url:
        "https://example.test/blue-light-card/thanks?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://example.test/blue-light-card?cancelled=1",
      expires_at: Math.ceil(Date.now() / 1000) + 30 * 60 + 60,
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: { message: BLC_CHECKOUT_TERMS },
      },
      subscription_data: {
        metadata: {
          supabase_user_id: USER,
          tier_name: "premium",
          billing_cycle: "yearly",
          cadence: "annual",
          channel: "blc",
          voucher: "BLC-TEST",
          tduid: "td_click_1",
          campaign_slug: "blc-launch",
        },
      },
      metadata: {
        channel: "blc",
        supabase_user_id: USER,
        tier: "premium",
        cadence: "annual",
        billing_cycle: "yearly",
        email: "member@example.test",
        voucher: "BLC-TEST",
        tduid: "td_click_1",
        campaign_slug: "blc-launch",
        event_id: "evt-blc-1",
        marketing_consent: "true",
        fbc: "",
        fbp: "fb.1.1.xyz",
      },
    });
    expect(options).toEqual({
      idempotencyKey: `blc-checkout:${USER}:evt-blc-1`,
    });
    // The member price comes ONLY from the verified code — no code box on
    // Stripe's page.
    expect(params).not.toHaveProperty("allow_promotion_codes");
  });

  it("ticks the buyer into the partnership's cancellation position", () => {
    expect(BLC_CHECKOUT_TERMS).toBe(
      "I agree to the Persistence terms. My Blue Light Card member price continues while the partnership runs, I can cancel any time, and I can get a full refund within 14 days unless I've started using the app.",
    );
  });

  it("mints an event id when the browser sent none, and keys idempotency on it", async () => {
    await checkout({ ...VALID, event_id: undefined });
    const [params, options] = stripeMocks.create.mock.calls[0]! as [
      { metadata: { event_id: string } },
      { idempotencyKey: string },
    ];
    expect(params.metadata.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(options.idempotencyKey).toBe(
      `blc-checkout:${USER}:${params.metadata.event_id}`,
    );
    expect(emitEventMock.mock.calls[0]![0]).toMatchObject({
      eventId: params.metadata.event_id,
    });
  });

  it.each([
    ["premium", "monthly"],
    ["premium", "annual"],
    ["premium_plus", "monthly"],
    ["premium_plus", "annual"],
  ])("resolves the %s/%s Price and sells from it", async (tier, cadence) => {
    await checkout({ ...VALID, tier, cadence });
    expect(priceMock).toHaveBeenCalledWith(tier, cadence);
    const params = stripeMocks.create.mock.calls[0]![0] as {
      line_items: Array<{ price: string }>;
      subscription_data: { metadata: { billing_cycle: string } };
    };
    expect(params.line_items[0]!.price).toBe(`price_${tier}_${cadence}`);
    expect(params.subscription_data.metadata.billing_cycle).toBe(
      cadence === "annual" ? "yearly" : "monthly",
    );
  });

  it("emits checkout_started as intent, with the cadence and not a months count", async () => {
    await checkout(VALID);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "checkout_started",
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

  it("drops a malformed campaign slug and an absent tduid without refusing", async () => {
    await checkout({
      ...VALID,
      campaign: "Not A Slug!",
      tduid: undefined,
      marketing_consent: false,
      fbp: undefined,
      fbc: "fb.1.1.click",
    });
    const params = stripeMocks.create.mock.calls[0]![0] as {
      metadata: Record<string, string>;
      subscription_data: { metadata: Record<string, string> };
    };
    expect(params.metadata.campaign_slug).toBe("");
    expect(params.metadata.tduid).toBe("");
    expect(params.metadata.marketing_consent).toBe("false");
    expect(params.metadata.fbc).toBe("fb.1.1.click");
    expect(params.subscription_data.metadata.campaign_slug).toBe("");
    expect(emitEventMock.mock.calls[0]![0]).toMatchObject({
      properties: { marketing_consent: false, fbc: "fb.1.1.click" },
    });
    expect(
      (emitEventMock.mock.calls[0]![0] as { properties: object }).properties,
    ).not.toHaveProperty("campaign");
  });

  it("falls back to the production site when no origin is configured", async () => {
    vi.stubEnv("WEB_ORIGIN", "");
    await checkout(VALID);
    const params = stripeMocks.create.mock.calls[0]![0] as {
      success_url: string;
    };
    expect(params.success_url).toContain(
      "https://persistence.evans-software-solutions.com/blue-light-card/thanks",
    );
  });

  describe("refusals", () => {
    it("requires a sign-in before anything is looked up", async () => {
      authMocks.user.mockResolvedValueOnce(null as never);
      expect((await checkout(VALID)).status).toBe(401);
      expect(codeMock).not.toHaveBeenCalled();
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("rejects an unconfirmed auth identity even with a valid token", async () => {
      authMocks.identity.mockResolvedValueOnce({
        id: USER,
        email: "member@example.test",
        emailConfirmedAt: null,
      } as never);
      const res = await checkout(VALID);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        ok: false,
        error: "email_not_verified",
      });
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("fails closed on an identity lookup outage", async () => {
      authMocks.identity.mockRejectedValueOnce(new Error("offline"));
      expect((await checkout(VALID)).status).toBe(503);
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("answers a filled honeypot like a success and does nothing", async () => {
      const res = await checkout({ ...VALID, hp: "bot" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        url: "https://example.test/blue-light-card/thanks",
      });
      expect(turnstileMock).not.toHaveBeenCalled();
      expect(codeMock).not.toHaveBeenCalled();
      expect(stripeMocks.create).not.toHaveBeenCalled();
      expect(emitEventMock).not.toHaveBeenCalled();
    });

    it("refuses when no bot challenge is configured", async () => {
      turnstileMock.mockResolvedValue("skipped");
      const res = await checkout(VALID);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: "not_configured" });
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("refuses a failed Turnstile challenge before looking anything up", async () => {
      turnstileMock.mockResolvedValue("failed");
      const res = await checkout(VALID);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        ok: false,
        error: "challenge_failed",
      });
      expect(codeMock).not.toHaveBeenCalled();
    });

    it("refuses an invalid email", async () => {
      const res = await checkout({ ...VALID, email: "not-an-email" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_email" });
    });

    it("refuses a tier that is not in the offer", async () => {
      const res = await checkout({ ...VALID, tier: "start_up_coach_plus" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_tier" });
      expect(codeMock).not.toHaveBeenCalled();
    });

    it("refuses a cadence that is not in the offer", async () => {
      const res = await checkout({ ...VALID, cadence: "weekly" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_cadence" });
    });

    it("refuses a code that is not a live BLC code — before the account is looked at", async () => {
      codeMock.mockResolvedValue(null);
      const res = await checkout(VALID);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_code" });
      expect(repoMocks.eligibility).not.toHaveBeenCalled();
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("503s when the code cannot be checked", async () => {
      codeMock.mockRejectedValue(new Error("down"));
      expect((await checkout(VALID)).status).toBe(503);
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("refuses an account that already has a live subscription, with 409", async () => {
      repoMocks.eligibility.mockResolvedValue("active_subscription");
      const res = await checkout(VALID);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        ok: false,
        error: "active_subscription",
      });
      expect(repoMocks.eligibility).toHaveBeenCalledWith(USER);
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("refuses an ineligible account, with 403", async () => {
      repoMocks.eligibility.mockResolvedValue("account_ineligible");
      const res = await checkout(VALID);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        ok: false,
        error: "account_ineligible",
      });
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("503s when the Price cannot be verified", async () => {
      priceMock.mockRejectedValue(new Error("unverified"));
      const res = await checkout(VALID);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
      expect(stripeMocks.create).not.toHaveBeenCalled();
    });

    it("503s when Stripe cannot create the Session", async () => {
      stripeMocks.create.mockRejectedValue(new Error("response lost"));
      const res = await checkout(VALID);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
      expect(emitEventMock).not.toHaveBeenCalled();
    });

    it("503s when Stripe returns a Session with no url", async () => {
      stripeMocks.create.mockResolvedValue({ id: "cs_x" });
      expect((await checkout(VALID)).status).toBe(503);
      expect(emitEventMock).not.toHaveBeenCalled();
    });

    it("rate-limits a naive script on the shared leads budget", async () => {
      const ip = "198.51.100.9";
      for (let i = 0; i < 10; i += 1) {
        expect((await checkout(VALID, ip)).status).toBe(200);
      }
      const res = await checkout(VALID, ip);
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ ok: false, error: "rate_limited" });
    });
  });

  it("answers the preflight", async () => {
    const res = await (blcCheckoutHandler as unknown as Handler).handle(
      new Request("http://localhost/blc/checkout", { method: "OPTIONS" }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
  });
});

describe("GET /blc/checkout/:sessionId/status", () => {
  const SESSION = {
    id: "cs_test_1",
    status: "complete",
    amount_total: 11199,
    currency: "gbp",
    customer_email: "member@example.test",
    subscription: { id: "sub_blc_1" },
    metadata: {
      channel: "blc",
      tier: "premium",
      cadence: "annual",
      email: "member@example.test",
      event_id: "evt-blc-1",
    },
  };

  beforeEach(() => {
    stripeMocks.retrieve.mockResolvedValue(SESSION);
  });

  it("asks Stripe for the Session with its subscription expanded", async () => {
    await status("cs_test_1");
    expect(stripeMocks.retrieve).toHaveBeenCalledWith("cs_test_1", {
      expand: ["subscription"],
    });
  });

  it("reports a paid checkout whose access has landed", async () => {
    repoMocks.isLiveSubscription.mockResolvedValue(true);
    const res = await status("cs_test_1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({
      ok: true,
      data: {
        status: "completed",
        tier: "premium",
        cadence: "annual",
        emailMasked: "mem•••@ex•••••.test",
        amountMinor: 11199,
        currency: "GBP",
        eventId: "evt-blc-1",
        accessReady: true,
      },
    });
    expect(repoMocks.isLiveSubscription).toHaveBeenCalledWith("sub_blc_1");
  });

  it("reports a paid checkout the webhook has not mirrored yet", async () => {
    repoMocks.isLiveSubscription.mockResolvedValue(false);
    const body = (await (await status("cs_test_1")).json()) as {
      data: { status: string; accessReady: boolean };
    };
    expect(body.data).toMatchObject({
      status: "completed",
      accessReady: false,
    });
  });

  it("reads a subscription that came back as a bare id", async () => {
    repoMocks.isLiveSubscription.mockResolvedValue(true);
    stripeMocks.retrieve.mockResolvedValue({
      ...SESSION,
      subscription: "sub_blc_2",
    });
    const body = (await (await status("cs_test_1")).json()) as {
      data: { accessReady: boolean };
    };
    expect(body.data.accessReady).toBe(true);
    expect(repoMocks.isLiveSubscription).toHaveBeenCalledWith("sub_blc_2");
  });

  it("is never 'ready' without a subscription, even when complete", async () => {
    stripeMocks.retrieve.mockResolvedValue({ ...SESSION, subscription: null });
    const body = (await (await status("cs_test_1")).json()) as {
      data: { accessReady: boolean };
    };
    expect(body.data.accessReady).toBe(false);
    expect(repoMocks.isLiveSubscription).not.toHaveBeenCalled();
  });

  it("reports an open checkout without asking the database", async () => {
    stripeMocks.retrieve.mockResolvedValue({ ...SESSION, status: "open" });
    const body = (await (await status("cs_test_1")).json()) as {
      data: { status: string; accessReady: boolean };
    };
    expect(body.data).toMatchObject({ status: "open", accessReady: false });
    expect(repoMocks.isLiveSubscription).not.toHaveBeenCalled();
  });

  it("reports an expired checkout", async () => {
    stripeMocks.retrieve.mockResolvedValue({ ...SESSION, status: "expired" });
    const body = (await (await status("cs_test_1")).json()) as {
      data: { status: string };
    };
    expect(body.data.status).toBe("expired");
  });

  it("falls back to the Session's own email and a stable event id", async () => {
    stripeMocks.retrieve.mockResolvedValue({
      ...SESSION,
      amount_total: null,
      currency: null,
      metadata: { channel: "blc" },
    });
    const body = (await (await status("cs_test_1")).json()) as {
      data: Record<string, unknown>;
    };
    expect(body.data).toEqual({
      status: "completed",
      tier: null,
      cadence: null,
      emailMasked: "mem•••@ex•••••.test",
      amountMinor: 0,
      currency: "GBP",
      eventId: "blc-purchase:cs_test_1",
      accessReady: false,
    });
  });

  it("404s for a Session that is not one of ours", async () => {
    stripeMocks.retrieve.mockResolvedValue({
      ...SESSION,
      metadata: { tier: "premium", months: "6" },
    });
    const res = await status("cs_founding");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
  });

  it("404s when Stripe does not know the id", async () => {
    stripeMocks.retrieve.mockRejectedValue(
      Object.assign(new Error("No such checkout.session: 'cs_nope'"), {
        statusCode: 404,
        code: "resource_missing",
      }),
    );
    const res = await status("cs_nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
  });

  it("404s on Stripe's resource_missing code even without a status code", async () => {
    stripeMocks.retrieve.mockRejectedValue(
      Object.assign(new Error("No such checkout.session"), {
        code: "resource_missing",
      }),
    );
    expect((await status("cs_nope")).status).toBe(404);
  });

  it("503s, not 404s, on a transient Stripe failure so the thanks page keeps polling", async () => {
    for (const blip of [
      Object.assign(new Error("Too many requests"), { statusCode: 429 }),
      Object.assign(new Error("Stripe is down"), { statusCode: 502 }),
      new Error("socket hang up"),
      "not even an Error",
    ]) {
      stripeMocks.retrieve.mockRejectedValueOnce(blip);
      const res = await status("cs_test_1");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
    }
  });

  it("rate-limits a poller generously", async () => {
    const ip = "198.51.100.42";
    for (let i = 0; i < 120; i += 1) {
      expect((await status("cs_test_1", ip)).status).toBe(200);
    }
    expect((await status("cs_test_1", ip)).status).toBe(429);
  });
});
