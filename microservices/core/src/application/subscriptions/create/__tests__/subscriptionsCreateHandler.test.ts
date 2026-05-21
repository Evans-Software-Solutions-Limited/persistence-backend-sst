/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// ─── Module-level mocks (must be hoisted before importing the handler) ─

const subscriptionRepositoryMocks = {
  findMostRecentForUser: vi.fn(),
  insert: vi.fn(),
};

const profileRepositoryMocks = {
  getById: vi.fn(),
  update: vi.fn(),
};

const stripeMock = {
  customers: {
    retrieve: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  paymentMethods: {
    attach: vi.fn(),
  },
  subscriptions: {
    create: vi.fn(),
    cancel: vi.fn(),
  },
};

const dbSelectMock = vi.fn();

vi.mock("@persistence/db/client", () => ({
  getDb: () => ({
    select: dbSelectMock,
  }),
}));

vi.mock("@persistence/db", () => ({
  subscriptionTiers: {
    tierName: { name: "tier_name" },
    stripePriceIdMonthly: { name: "stripe_price_id_monthly" },
    stripePriceIdYearly: { name: "stripe_price_id_yearly" },
    currency: { name: "currency" },
    isTrainerTier: { name: "is_trainer_tier" },
  },
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "user-1",
      email: "test@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "user-1" }),
}));

vi.mock("../../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi
    .fn()
    .mockImplementation(() => subscriptionRepositoryMocks),
}));

vi.mock("../../../repositories/profileRepository", () => ({
  ProfileRepository: vi
    .fn()
    .mockImplementation(() => profileRepositoryMocks),
}));

vi.mock("../../../stripe/stripeClient", () => ({
  getStripe: () => stripeMock,
}));

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Build the Drizzle `select().from().where().limit()` chain return.
 * `resolvePrice` is the only consumer in the handler; mock it per-test
 * via `mockPriceLookup` below.
 */
function mockPriceLookup(row: {
  priceMonthly?: string | null;
  priceYearly?: string | null;
  currency?: string | null;
  isTrainerTier?: boolean | null;
} | null) {
  dbSelectMock.mockImplementationOnce(() => ({
    from: () => ({
      where: () => ({
        limit: async () => (row === null ? [] : [row]),
      }),
    }),
  }));
}

function buildStripeSubscription(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
  return {
    id: "sub_new",
    status: "trialing",
    trial_end: 1700604800,
    items: { data: [{ current_period_end: 1700604800 }] },
    latest_invoice: null,
    metadata: {},
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function fakeProfile(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "test@example.com",
    fullName: "Test User",
    hasUsedUserTrial: false,
    hasUsedTrainerTrial: false,
    ...over,
  };
}

async function postCreate(body: unknown, withAuth = true) {
  const { subscriptionsCreateHandler } = await import(
    "../subscriptionsCreateHandler"
  );
  return subscriptionsCreateHandler.handle(
    new Request("http://localhost/subscriptions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(withAuth ? { authorization: "Bearer test-token" } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const validBody = {
  tier_name: "premium",
  billing_cycle: "monthly" as const,
  payment_method_id: "pm_card",
  use_trial: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValue(null);
  subscriptionRepositoryMocks.insert.mockResolvedValue({ id: "us_new" });
  profileRepositoryMocks.getById.mockResolvedValue(fakeProfile());
  profileRepositoryMocks.update.mockResolvedValue(fakeProfile());
  stripeMock.customers.create.mockResolvedValue({ id: "cus_new" });
  stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_existing" });
  stripeMock.customers.update.mockResolvedValue({});
  stripeMock.paymentMethods.attach.mockResolvedValue({});
  stripeMock.subscriptions.create.mockResolvedValue(buildStripeSubscription());
  stripeMock.subscriptions.cancel.mockResolvedValue({});
});

// ─── Pure-helper tests ───────────────────────────────────────────────

describe("subscriptionsCreateHandler — pure helpers", () => {
  it("derivePaymentStatus maps Stripe statuses to local payment_status", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const { derivePaymentStatus } = __internals;
    expect(
      derivePaymentStatus(buildStripeSubscription({ status: "trialing" })),
    ).toBe("trialing");
    expect(
      derivePaymentStatus(buildStripeSubscription({ status: "active" })),
    ).toBe("active");
    expect(
      derivePaymentStatus(buildStripeSubscription({ status: "past_due" })),
    ).toBe("past_due");
    expect(
      derivePaymentStatus(buildStripeSubscription({ status: "canceled" })),
    ).toBe("pending");
  });

  it("derivePaymentStatus reads payment_intent.succeeded for incomplete subs", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const incomplete = buildStripeSubscription({
      status: "incomplete",
      latest_invoice: {
        payment_intent: { status: "succeeded" },
      } as unknown as Stripe.Invoice,
    });
    expect(__internals.derivePaymentStatus(incomplete)).toBe("active");
    const failing = buildStripeSubscription({
      status: "incomplete",
      latest_invoice: {
        payment_intent: { status: "requires_action" },
      } as unknown as Stripe.Invoice,
    });
    expect(__internals.derivePaymentStatus(failing)).toBe("pending");
  });

  it("resolveTrial returns 7-day user trial only when tier=premium, eligible, opted-in", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const { resolveTrial } = __internals;
    expect(resolveTrial("premium", false, true, false, false)).toEqual({
      days: 7,
      flag: "user",
    });
    expect(resolveTrial("premium", false, true, true, false)).toEqual({
      days: 0,
      flag: null,
    });
    expect(resolveTrial("premium", false, false, false, false)).toEqual({
      days: 0,
      flag: null,
    });
  });

  it("resolveTrial returns 14-day trainer trial only for *_pro trainer tiers when eligible", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const { resolveTrial } = __internals;
    expect(
      resolveTrial("individual_trainer_pro", true, true, false, false),
    ).toEqual({ days: 14, flag: "trainer" });
    // already used → 0
    expect(
      resolveTrial("individual_trainer_pro", true, true, false, true),
    ).toEqual({ days: 0, flag: null });
    // standard trainer tier (no _pro suffix) → no trial
    expect(
      resolveTrial(
        "individual_trainer_standard",
        true,
        true,
        false,
        false,
      ),
    ).toEqual({ days: 0, flag: null });
    // is_trainer_tier flag false but name ends _pro — guard rejects
    expect(
      resolveTrial("rogue_pro", false, true, false, false),
    ).toEqual({ days: 0, flag: null });
  });

  it("resolveTrial returns no trial for basic + non-pro trainer tiers", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const { resolveTrial } = __internals;
    expect(resolveTrial("basic", false, true, false, false)).toEqual({
      days: 0,
      flag: null,
    });
  });

  it("isReinstateable: same tier + cycle + reinstateable status", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const { isReinstateable } = __internals;
    const row = {
      tierName: "premium",
      billingCycle: "monthly",
      paymentStatus: "cancelled",
    } as any;
    expect(isReinstateable(row, "premium", "monthly")).toBe(true);
    expect(isReinstateable(row, "premium", "yearly")).toBe(false);
    expect(isReinstateable(row, "basic", "monthly")).toBe(false);
    expect(
      isReinstateable({ ...row, paymentStatus: "active" }, "premium", "monthly"),
    ).toBe(false);
    expect(
      isReinstateable({ ...row, paymentStatus: "trialing" }, "premium", "monthly"),
    ).toBe(true);
    expect(
      isReinstateable({ ...row, paymentStatus: "past_due" }, "premium", "monthly"),
    ).toBe(true);
    expect(
      isReinstateable({ ...row, paymentStatus: "canceled" }, "premium", "monthly"),
    ).toBe(true);
  });

  it("readCurrentPeriodEnd prefers legacy top-level, falls back to items", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const { readCurrentPeriodEnd } = __internals;
    expect(
      readCurrentPeriodEnd({
        current_period_end: 100,
        items: { data: [{ current_period_end: 200 }] },
      } as any),
    ).toBe(100);
    expect(
      readCurrentPeriodEnd({
        items: { data: [{ current_period_end: 200 }] },
      } as any),
    ).toBe(200);
    expect(
      readCurrentPeriodEnd({ items: { data: [] } } as any),
    ).toBeNull();
  });
});

// ─── Handler integration tests — new-subscription path ───────────────

describe("subscriptionsCreateHandler — POST /subscriptions (new sub path)", () => {
  it("returns 401 without auth", async () => {
    const res = await postCreate(validBody, false);
    expect(res.status).toBe(401);
  });

  it("rejects tier_name=free with 400", async () => {
    const res = await postCreate({ ...validBody, tier_name: "free" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("free tier"),
    });
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
  });

  it("returns 400 when the tier lookup yields no matching price id", async () => {
    mockPriceLookup({
      priceMonthly: null,
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    const res = await postCreate(validBody);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("not configured"),
    });
  });

  it("returns 404 when the profile row is missing", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: "price_premium_yearly",
      currency: "GBP",
      isTrainerTier: false,
    });
    profileRepositoryMocks.getById.mockResolvedValueOnce(null);
    const res = await postCreate(validBody);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "User profile not found" });
  });

  it("creates a new sub end-to-end, flips trial flag, returns happy-path response", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_new",
        status: "trialing",
        trial_end: 1700604800,
      }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      requires_action: false,
      subscription_id: "us_new",
      stripe_subscription_id: "sub_new",
      payment_status: "trialing",
    });

    // Customer creation (no prior customer id)
    expect(stripeMock.customers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();

    // Payment method attach + default
    expect(stripeMock.paymentMethods.attach).toHaveBeenCalledWith("pm_card", {
      customer: "cus_new",
    });
    expect(stripeMock.customers.update).toHaveBeenCalledWith("cus_new", {
      invoice_settings: { default_payment_method: "pm_card" },
    });

    // Stripe subscription create — with trial
    const createCall = stripeMock.subscriptions.create.mock.calls[0][0];
    expect(createCall.trial_period_days).toBe(7);
    expect(createCall.metadata).toMatchObject({
      supabase_user_id: "user-1",
      tier_name: "premium",
      billing_cycle: "monthly",
    });

    // DB insert
    const insertPayload = subscriptionRepositoryMocks.insert.mock.calls[0][0];
    expect(insertPayload).toMatchObject({
      userId: "user-1",
      tierName: "premium",
      billingCycle: "monthly",
      currency: "GBP",
      paymentStatus: "trialing",
      externalSubscriptionId: "sub_new",
    });
    expect(insertPayload.metadata).toMatchObject({
      stripe_customer_id: "cus_new",
      stripe_subscription_id: "sub_new",
      stripe_payment_method_id: "pm_card",
    });
    expect(insertPayload.metadata.requires_3d_secure).toBeUndefined();

    // Trial flag flipped on profile
    expect(profileRepositoryMocks.update).toHaveBeenCalledWith("user-1", {
      hasUsedUserTrial: true,
    });
  });

  it("does NOT request a trial when use_trial=false (no Stripe trial, no profile flag)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_no_trial",
        status: "active",
        trial_end: null as unknown as number,
      }),
    );
    await postCreate({ ...validBody, use_trial: false });

    const createCall = stripeMock.subscriptions.create.mock.calls[0][0];
    expect(createCall.trial_period_days).toBeUndefined();
    expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
  });

  it("rolls back Stripe sub when the DB insert fails", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_to_rollback" }),
    );
    subscriptionRepositoryMocks.insert.mockRejectedValueOnce(
      new Error("connection reset by peer"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_to_rollback",
    );
    // Trial flag should NOT have been flipped (rollback short-circuits)
    expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("logs but does not error when the Stripe rollback ALSO fails after DB-insert failure", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_double_fail" }),
    );
    subscriptionRepositoryMocks.insert.mockRejectedValueOnce(
      new Error("neon timeout"),
    );
    stripeMock.subscriptions.cancel.mockRejectedValueOnce(
      new Error("stripe 503"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Stripe rollback ALSO failed"),
    );
    errSpy.mockRestore();
  });

  it("tolerates resource_already_exists on payment method attach", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    const attachErr: any = new Error("already attached");
    attachErr.code = "resource_already_exists";
    stripeMock.paymentMethods.attach.mockRejectedValueOnce(attachErr);
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_reuse_pm" }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    expect(stripeMock.customers.update).toHaveBeenCalled();
  });

  it("returns 400 with a useful message on other payment method attach failures", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    const attachErr: any = new Error("card declined");
    attachErr.code = "card_declined";
    stripeMock.paymentMethods.attach.mockRejectedValueOnce(attachErr);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("card declined"),
    });
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns 500 when stripe.subscriptions.create throws", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    stripeMock.subscriptions.create.mockRejectedValueOnce(
      new Error("price not found on Stripe"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("price not found"),
    });
    errSpy.mockRestore();
  });

  it("returns requires_action when latest_invoice.payment_intent.status=requires_action", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_3ds",
        status: "incomplete",
        trial_end: null as unknown as number,
        latest_invoice: {
          payment_intent: {
            status: "requires_action",
            client_secret: "pi_3ds_secret_xyz",
          },
        } as unknown as Stripe.Invoice,
      }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      requires_action: true,
      subscription_id: "us_new",
      stripe_subscription_id: "sub_3ds",
      payment_status: "pending",
      client_secret: "pi_3ds_secret_xyz",
    });

    // DB row should have been written as pending + flagged
    const insertPayload = subscriptionRepositoryMocks.insert.mock.calls[0][0];
    expect(insertPayload.paymentStatus).toBe("pending");
    expect(insertPayload.metadata.requires_3d_secure).toBe(true);

    // Trial flag still flipped immediately on 3DS path — abandon-proof
    expect(profileRepositoryMocks.update).toHaveBeenCalledWith("user-1", {
      hasUsedUserTrial: true,
    });
  });

  it("returns 501 placeholder for reinstate-eligible existing rows (Phase 2A.2 not yet landed)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce({
      id: "us_old",
      tierName: "premium",
      billingCycle: "monthly",
      paymentStatus: "cancelled",
      metadata: { stripe_subscription_id: "sub_old" },
    });
    const res = await postCreate(validBody);
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("Reinstatement"),
    });
  });

  it("returns 501 placeholder for subscription-change existing rows (Phase 2A.3 not yet landed)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce({
      id: "us_old",
      tierName: "basic",
      billingCycle: "monthly",
      paymentStatus: "active",
      metadata: { stripe_subscription_id: "sub_old_active" },
    });
    const res = await postCreate(validBody);
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("Subscription-change"),
    });
  });

  it("reuses an existing Stripe customer when metadata.stripe_customer_id resolves", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    // Existing row carries a customer id but no stripe_subscription_id — so we
    // fall into the new-sub path (not reinstate, not change), but we reuse
    // the customer.
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce({
      id: "us_prev",
      tierName: "basic",
      billingCycle: "monthly",
      paymentStatus: "expired",
      metadata: { stripe_customer_id: "cus_legacy" },
    });
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    expect(stripeMock.customers.retrieve).toHaveBeenCalledWith("cus_legacy");
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
  });

  it("falls through to create a fresh customer when retrieve fails", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce({
      id: "us_prev",
      tierName: "basic",
      billingCycle: "monthly",
      paymentStatus: "expired",
      metadata: { stripe_customer_id: "cus_stale" },
    });
    stripeMock.customers.retrieve.mockRejectedValueOnce(
      Object.assign(new Error("No such customer"), {
        code: "resource_missing",
      }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    expect(stripeMock.customers.create).toHaveBeenCalled();
  });

  it("does not flip trial flag when use_trial=true but the user has already used the trial", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    profileRepositoryMocks.getById.mockResolvedValueOnce(
      fakeProfile({ hasUsedUserTrial: true }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ status: "active", trial_end: null as any }),
    );
    await postCreate(validBody);
    const createCall = stripeMock.subscriptions.create.mock.calls[0][0];
    expect(createCall.trial_period_days).toBeUndefined();
    expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
  });

  it("flips hasUsedTrainerTrial on a trainer pro tier when eligible", async () => {
    mockPriceLookup({
      priceMonthly: "price_trainer_pro_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: true,
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_trainer_trial", status: "trialing" }),
    );
    const res = await postCreate({
      ...validBody,
      tier_name: "individual_trainer_pro",
    });
    expect(res.status).toBe(200);
    const createCall = stripeMock.subscriptions.create.mock.calls[0][0];
    expect(createCall.trial_period_days).toBe(14);
    expect(profileRepositoryMocks.update).toHaveBeenCalledWith("user-1", {
      hasUsedTrainerTrial: true,
    });
  });

  it("logs but does not error when trial flag update fails after a successful subscription", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    profileRepositoryMocks.update.mockRejectedValueOnce(
      new Error("neon transient"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("trial flag update failed"),
    );
    errSpy.mockRestore();
  });
});
