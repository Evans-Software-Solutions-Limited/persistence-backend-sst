/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// ─── Module-level mocks (must be hoisted before importing the handler) ─

const subscriptionRepositoryMocks = {
  findMostRecentForUser: vi.fn(),
  insert: vi.fn(),
  updateById: vi.fn(),
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
    update: vi.fn(),
    cancel: vi.fn(),
    retrieve: vi.fn(),
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
  ProfileRepository: vi.fn().mockImplementation(() => profileRepositoryMocks),
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
function mockPriceLookup(
  row: {
    priceMonthly?: string | null;
    priceYearly?: string | null;
    currency?: string | null;
    isTrainerTier?: boolean | null;
    /**
     * M10-added decimal amounts read by the M10 dispatch for change-type
     * derivation. Tests that don't set these get a sensible default
     * (priceMonthlyAmount mirrors priceMonthly's Stripe-priced shape;
     * for upgrade-path tests it should be set explicitly).
     */
    priceMonthlyAmount?: string | null;
    priceYearlyAmount?: string | null;
  } | null,
) {
  // Default `priceMonthlyAmount` to "14.99" (premium tier price) so legacy
  // PR #70 tests that pre-date the M10 amount fields still drive the
  // upgrade-vs-downgrade comparison sensibly when paired with the
  // change-path's default 0-fallback for missing old prices.
  const enriched =
    row === null
      ? null
      : {
          priceMonthlyAmount: "14.99",
          priceYearlyAmount: null,
          ...row,
        };
  dbSelectMock.mockImplementationOnce(() => ({
    from: () => ({
      where: () => ({
        limit: async () => (enriched === null ? [] : [enriched]),
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
  const { subscriptionsCreateHandler } =
    await import("../subscriptionsCreateHandler");
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
  // vi.clearAllMocks() only clears call history; queued
  // mockResolvedValueOnce returns from prior tests survive. Reset the
  // mocks that use queued returns so a leftover from a previous test
  // doesn't bleed into the default-null path here.
  subscriptionRepositoryMocks.findMostRecentForUser.mockReset();
  subscriptionRepositoryMocks.insert.mockReset();
  subscriptionRepositoryMocks.updateById.mockReset();
  profileRepositoryMocks.getById.mockReset();
  profileRepositoryMocks.update.mockReset();
  dbSelectMock.mockReset();
  stripeMock.subscriptions.create.mockReset();
  stripeMock.subscriptions.update.mockReset();
  stripeMock.subscriptions.cancel.mockReset();
  stripeMock.subscriptions.retrieve.mockReset();
  stripeMock.customers.create.mockReset();
  stripeMock.customers.retrieve.mockReset();
  stripeMock.customers.update.mockReset();
  stripeMock.paymentMethods.attach.mockReset();

  subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValue(null);
  subscriptionRepositoryMocks.insert.mockResolvedValue({ id: "us_new" });
  subscriptionRepositoryMocks.updateById.mockImplementation(
    async (id: string, patch: Record<string, unknown>) => ({
      id,
      ...patch,
    }),
  );
  stripeMock.subscriptions.update.mockResolvedValue(buildStripeSubscription());
  stripeMock.subscriptions.retrieve.mockResolvedValue(
    buildStripeSubscription({
      id: "sub_old_active",
      items: {
        data: [{ id: "si_existing_item", current_period_end: 1700604800 }],
      } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
    }),
  );
  profileRepositoryMocks.getById.mockResolvedValue(fakeProfile());
  profileRepositoryMocks.update.mockResolvedValue(fakeProfile());
  stripeMock.customers.create.mockResolvedValue({ id: "cus_new" });
  stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_existing" });
  stripeMock.customers.update.mockResolvedValue({});
  stripeMock.paymentMethods.attach.mockResolvedValue({});
  stripeMock.subscriptions.create.mockResolvedValue(buildStripeSubscription());
  stripeMock.subscriptions.cancel.mockResolvedValue({});
  // Default dbSelectMock fallback for any unmocked SELECTs. M10 added a
  // second SELECT to the change-path (resolveTierPrices for the existing
  // tier's price comparison) — tests that don't explicitly mock it get
  // an empty-array response, which the change-type derivation
  // defensively treats as "tier not found → upgrade-by-default".
  dbSelectMock.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => [],
      }),
    }),
  }));
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
      resolveTrial("individual_trainer_standard", true, true, false, false),
    ).toEqual({ days: 0, flag: null });
    // is_trainer_tier flag false but name ends _pro — guard rejects
    expect(resolveTrial("rogue_pro", false, true, false, false)).toEqual({
      days: 0,
      flag: null,
    });
  });

  it("resolveTrial returns no trial for basic + non-pro trainer tiers", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const { resolveTrial } = __internals;
    expect(resolveTrial("basic", false, true, false, false)).toEqual({
      days: 0,
      flag: null,
    });
  });

  it("isReinstateable: same tier + cycle + reinstateable status (past_due / trialing only)", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const { isReinstateable } = __internals;
    const row = {
      tierName: "premium",
      billingCycle: "monthly",
      paymentStatus: "past_due",
    } as any;
    expect(isReinstateable(row, "premium", "monthly")).toBe(true);
    expect(isReinstateable(row, "premium", "yearly")).toBe(false);
    expect(isReinstateable(row, "basic", "monthly")).toBe(false);
    expect(
      isReinstateable(
        { ...row, paymentStatus: "active" },
        "premium",
        "monthly",
      ),
    ).toBe(false);
    expect(
      isReinstateable(
        { ...row, paymentStatus: "trialing" },
        "premium",
        "monthly",
      ),
    ).toBe(true);
    // Permanently-cancelled statuses are NOT reinstateable (Inspector
    // Brad PR #70 sweep #2): the underlying Stripe sub is dead and
    // can't be resumed, so these rows fall through to the change-path.
    expect(
      isReinstateable(
        { ...row, paymentStatus: "cancelled" },
        "premium",
        "monthly",
      ),
    ).toBe(false);
    expect(
      isReinstateable(
        { ...row, paymentStatus: "canceled" },
        "premium",
        "monthly",
      ),
    ).toBe(false);
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
    expect(readCurrentPeriodEnd({ items: { data: [] } } as any)).toBeNull();
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
    const body = (await res.json()) as any;
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
    const body = (await res.json()) as any;
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

  it("does not treat reinstateable status as reinstate when stripe_subscription_id is missing (falls through to new-sub)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce({
      id: "us_old_no_sub",
      tierName: "premium",
      billingCycle: "monthly",
      paymentStatus: "past_due",
      metadata: { stripe_customer_id: "cus_old" },
    });
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    // New-sub path runs (stripe.subscriptions.create), not reinstate (.update)
    expect(stripeMock.subscriptions.create).toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it("routes a cancelled-then-resubscribe (same tier+cycle) through change-path, not reinstate (Inspector Brad PR #70 sweep #2)", async () => {
    // Regression: previously REINSTATEMENT_STATUSES included "cancelled"/
    // "canceled", which always 500'd because Stripe refuses to
    // reactivate canceled subs. The row now falls through to the
    // change-path, which creates a fresh Stripe sub.
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce({
      id: "us_old_cancelled",
      userId: "user-1",
      tierName: "premium",
      billingCycle: "monthly",
      paymentStatus: "cancelled",
      metadata: {
        stripe_customer_id: "cus_existing",
        stripe_subscription_id: "sub_old_dead",
      },
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_resub", status: "active" }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    // Change-path = create + update, NOT reinstate-via-update
    expect(stripeMock.subscriptions.create).toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    const createCall = stripeMock.subscriptions.create.mock.calls[0][0];
    expect(createCall.metadata.old_stripe_subscription_id).toBe("sub_old_dead");
  });

  it("dispatches change-path (not new-sub) when existing row has a stripe_subscription_id but different tier", async () => {
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
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_new", status: "trialing" }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    // Change-path UPDATES the existing row in place — never inserts.
    expect(subscriptionRepositoryMocks.insert).not.toHaveBeenCalled();
    expect(subscriptionRepositoryMocks.updateById).toHaveBeenCalled();
    // The new Stripe sub gets the old marker baked into its metadata.
    const createCall = stripeMock.subscriptions.create.mock.calls[0][0];
    expect(createCall.metadata.old_stripe_subscription_id).toBe(
      "sub_old_active",
    );
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

// ─── Handler integration tests — reinstatement path ──────────────────

/**
 * Build a reinstate-eligible existing row. Defaults to `past_due` —
 * `cancelled`/`canceled` are NO LONGER reinstateable (Inspector Brad
 * PR #70 sweep #2: Stripe rejects reactivation of permanently-canceled
 * subs). Rows in those statuses fall through to the change-path.
 */
function reinstateableRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "us_old",
    userId: "user-1",
    tierName: "premium",
    billingCycle: "monthly",
    paymentStatus: "past_due",
    cancelledAt: null,
    metadata: {
      stripe_customer_id: "cus_existing",
      stripe_subscription_id: "sub_old",
      platform: "ios",
    },
    ...over,
  };
}

describe("subscriptionsCreateHandler — reinstatement path", () => {
  it("resumes the existing Stripe sub, updates the local row, clears cancelledAt, does NOT flip trial flags", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow(),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old",
        status: "active",
        trial_end: null as unknown as number,
      }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      success: true,
      requires_action: false,
      subscription_id: "us_old",
      stripe_subscription_id: "sub_old",
      payment_status: "active",
      reinstated: true,
    });

    // Stripe update call shape
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith("sub_old", {
      cancel_at_period_end: false,
      default_payment_method: "pm_card",
      expand: ["latest_invoice.payment_intent"],
    });
    // Reinstate must NOT create a new Stripe sub
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();

    // Local row updated, cancelledAt cleared, prior metadata preserved
    expect(subscriptionRepositoryMocks.updateById).toHaveBeenCalledTimes(1);
    const [updatedId, patch] =
      subscriptionRepositoryMocks.updateById.mock.calls[0];
    expect(updatedId).toBe("us_old");
    expect(patch.cancelledAt).toBeNull();
    expect(patch.paymentStatus).toBe("active");
    expect(patch.externalSubscriptionId).toBe("sub_old");
    expect((patch.metadata as Record<string, unknown>).stripe_customer_id).toBe(
      "cus_existing",
    );
    expect((patch.metadata as Record<string, unknown>).platform).toBe("ios");
    expect((patch.metadata as Record<string, unknown>).reinstated_at).toEqual(
      expect.any(String),
    );

    // Trial flags are NOT touched on reinstate — per Brad Q6
    expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
  });

  it("reuses the existing customer when retrievable (no new customer)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow(),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_old", status: "active" }),
    );
    await postCreate(validBody);
    expect(stripeMock.customers.retrieve).toHaveBeenCalledWith("cus_existing");
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
  });

  it("returns 3DS shape when the resumed sub's latest invoice needs action", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow({ paymentStatus: "past_due" }),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old",
        status: "past_due",
        latest_invoice: {
          payment_intent: {
            status: "requires_action",
            client_secret: "pi_reinstate_3ds_secret",
          },
        } as unknown as Stripe.Invoice,
      }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      success: true,
      requires_action: true,
      subscription_id: "us_old",
      stripe_subscription_id: "sub_old",
      payment_status: "pending",
      client_secret: "pi_reinstate_3ds_secret",
      reinstated: true,
    });
    const [, patch] = subscriptionRepositoryMocks.updateById.mock.calls[0];
    expect(patch.paymentStatus).toBe("pending");
    expect((patch.metadata as Record<string, unknown>).requires_3d_secure).toBe(
      true,
    );
  });

  it("returns 500 with operator-friendly message when stripe.subscriptions.update throws", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow(),
    );
    stripeMock.subscriptions.update.mockRejectedValueOnce(
      new Error("stripe 503"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("Failed to reinstate"),
    });
    expect(subscriptionRepositoryMocks.updateById).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("returns 500 with a support-id when Stripe sub resumed but updateById returns null", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow(),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_old", status: "active" }),
    );
    subscriptionRepositoryMocks.updateById.mockResolvedValueOnce(null);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("sub_old"),
    });
    errSpy.mockRestore();
  });

  it("returns 400 if attaching the payment method fails on the reinstate path", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow(),
    );
    const attachErr: any = new Error("card declined");
    attachErr.code = "card_declined";
    stripeMock.paymentMethods.attach.mockRejectedValueOnce(attachErr);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(400);
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("clears requires_3d_secure flag from prior metadata when the resumed sub no longer needs action", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow({
        metadata: {
          stripe_customer_id: "cus_existing",
          stripe_subscription_id: "sub_old",
          requires_3d_secure: true,
        },
      }),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_old", status: "active" }),
    );
    await postCreate(validBody);
    const [, patch] = subscriptionRepositoryMocks.updateById.mock.calls[0];
    expect(
      (patch.metadata as Record<string, unknown>).requires_3d_secure,
    ).toBeUndefined();
  });

  it("returns 409 when the row carries an in-flight old_stripe_subscription_id marker (Inspector Brad PR #70 sweep #8)", async () => {
    // Regression: pre-fix, the change-path's 409 guard lived inside
    // handleSubscriptionChange, so the REINSTATE path completely
    // bypassed it. A row with paymentStatus="trialing" + a stale
    // old_stripe_subscription_id (e.g. cancelOldSubscriptionWithRetry
    // exhausted its 3 attempts) would reinstate successfully, but
    // handleReinstate's `...existingMeta` spread carried the marker
    // forward and the orphaned predecessor kept billing.
    //
    // The guard now lives above the dispatch, so reinstate + change +
    // any future branch all get refused uniformly.
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow({
        // trialing → reinstate-eligible per REINSTATEMENT_STATUSES,
        // but the marker should refuse the call before dispatch.
        paymentStatus: "trialing",
        metadata: {
          stripe_customer_id: "cus_existing",
          stripe_subscription_id: "sub_trialing_b",
          old_stripe_subscription_id: "sub_a_orphaned",
        },
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("previous subscription change"),
    });
    // Critically: NO Stripe call against either sub. The webhook chain
    // for the in-flight change needs to settle first.
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    expect(subscriptionRepositoryMocks.updateById).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not enter reinstate when tier_name differs (falls through to change path)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow({ tierName: "basic" }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_changed", status: "active" }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    // change-path took over — Stripe.create was called (not .update)
    expect(stripeMock.subscriptions.create).toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it("does not enter reinstate when billing_cycle differs", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow({ billingCycle: "yearly" }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_changed", status: "active" }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.create).toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });
});

// ─── Handler integration tests — subscription-change path ────────────

/** Build an existing row that should drive the change-path. */
function changePathRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "us_existing",
    userId: "user-1",
    tierName: "basic",
    billingCycle: "monthly",
    paymentStatus: "active",
    cancelledAt: null,
    metadata: {
      stripe_customer_id: "cus_existing",
      stripe_subscription_id: "sub_old_active",
      platform: "ios",
    },
    ...over,
  };
}

describe("subscriptionsCreateHandler — subscription-change path", () => {
  it("creates a new Stripe sub stamped with old_stripe_subscription_id, updates the local row in place, clears cancelledAt", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow({ cancelledAt: new Date("2026-04-01") }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_new_premium",
        status: "trialing",
        trial_end: 1700604800,
      }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      success: true,
      requires_action: false,
      subscription_id: "us_existing", // UPDATED, not inserted
      stripe_subscription_id: "sub_new_premium",
      payment_status: "trialing",
    });
    // Should NOT be flagged as reinstated — that's the reinstate-path return shape.
    expect(body.reinstated).toBeUndefined();

    // Old marker propagated to BOTH Stripe metadata and local metadata
    const createCall = stripeMock.subscriptions.create.mock.calls[0][0];
    expect(createCall.metadata).toMatchObject({
      supabase_user_id: "user-1",
      tier_name: "premium",
      billing_cycle: "monthly",
      old_stripe_subscription_id: "sub_old_active",
    });

    // updateById was called — NOT insert
    expect(subscriptionRepositoryMocks.insert).not.toHaveBeenCalled();
    expect(subscriptionRepositoryMocks.updateById).toHaveBeenCalledTimes(1);
    const [updatedId, patch] =
      subscriptionRepositoryMocks.updateById.mock.calls[0];
    expect(updatedId).toBe("us_existing");
    expect(patch).toMatchObject({
      tierName: "premium",
      billingCycle: "monthly",
      currency: "GBP",
      paymentStatus: "trialing",
      externalSubscriptionId: "sub_new_premium",
      cancelledAt: null,
    });
    expect(patch.metadata).toMatchObject({
      stripe_subscription_id: "sub_new_premium",
      old_stripe_subscription_id: "sub_old_active",
      stripe_payment_method_id: "pm_card",
    });

    // Trial flag flipped (eligible — hasUsedUserTrial was false)
    expect(profileRepositoryMocks.update).toHaveBeenCalledWith("user-1", {
      hasUsedUserTrial: true,
    });

    // NO inline old-sub cancel — that's the webhook's job
    expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("returns 409 when a previous change is still in-flight (Inspector Brad PR #70 sweep #2)", async () => {
    // Regression: a returning user with an in-flight
    // old_stripe_subscription_id on their row (previous change A→B
    // never resolved by the webhook — abandoned 3DS, etc.) would
    // previously have their old marker overwritten by a new change
    // B→C, orphaning sub_A on Stripe. We now refuse with 409.
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow({
        metadata: {
          stripe_customer_id: "cus_existing",
          stripe_subscription_id: "sub_B_in_flight",
          old_stripe_subscription_id: "sub_A_still_active",
        },
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("previous subscription change"),
    });
    // No Stripe sub created — the webhook chain for the in-flight
    // change has to settle first.
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    expect(subscriptionRepositoryMocks.updateById).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("clears any pending requires_3d_secure from prior metadata when the new sub no longer needs 3DS (Inspector Brad PR #70)", async () => {
    // Regression: previously the change-path only SET the flag on a 3DS-
    // requiring response, but never CLEARED it on the else branch. A
    // user whose prior subscription required 3DS, then changes tier
    // with a card that doesn't require it, would end up with stale
    // metadata.requires_3d_secure: true on an active row.
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow({
        metadata: {
          stripe_customer_id: "cus_existing",
          stripe_subscription_id: "sub_old_active",
          requires_3d_secure: true,
        },
      }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_new_no_3ds", status: "active" }),
    );
    await postCreate(validBody);
    const [, patch] = subscriptionRepositoryMocks.updateById.mock.calls[0];
    expect(
      (patch.metadata as Record<string, unknown>).requires_3d_secure,
    ).toBeUndefined();
    // ...but the new old-sub marker IS present
    expect(
      (patch.metadata as Record<string, unknown>).old_stripe_subscription_id,
    ).toBe("sub_old_active");
  });

  it("preserves prior platform when the caller omits it on a change-of-tier (Inspector Brad PR #70)", async () => {
    // Regression: previously `platform: body.platform ?? null` hard-
    // overwrote the prior row's platform with `null` whenever the
    // caller omitted `platform` in the body. A returning iOS user
    // who changes tier through any caller that doesn't repeat the
    // platform field would lose their iOS attribution.
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow({
        metadata: {
          stripe_customer_id: "cus_existing",
          stripe_subscription_id: "sub_old_active",
          platform: "ios",
        },
      }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_new_no_platform", status: "active" }),
    );
    // validBody does NOT include `platform`
    await postCreate(validBody);
    const [, patch] = subscriptionRepositoryMocks.updateById.mock.calls[0];
    expect((patch.metadata as Record<string, unknown>).platform).toBe("ios");
  });

  it("overwrites prior platform when the caller does send one on a change-of-tier", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow({
        metadata: {
          stripe_customer_id: "cus_existing",
          stripe_subscription_id: "sub_old_active",
          platform: "ios",
        },
      }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_new_android", status: "active" }),
    );
    await postCreate({ ...validBody, platform: "android" });
    const [, patch] = subscriptionRepositoryMocks.updateById.mock.calls[0];
    expect((patch.metadata as Record<string, unknown>).platform).toBe(
      "android",
    );
  });

  it("clears any pending scheduled_downgrade marker per Q7", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow({
        metadata: {
          stripe_customer_id: "cus_existing",
          stripe_subscription_id: "sub_old_active",
          scheduled_downgrade: { new_tier: "basic" },
        },
      }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_new_premium", status: "active" }),
    );
    await postCreate(validBody);
    const [, patch] = subscriptionRepositoryMocks.updateById.mock.calls[0];
    expect(
      (patch.metadata as Record<string, unknown>).scheduled_downgrade,
    ).toBeUndefined();
    // ...but the new old-sub marker IS present
    expect(
      (patch.metadata as Record<string, unknown>).old_stripe_subscription_id,
    ).toBe("sub_old_active");
  });

  it("clears any pending scheduled_change marker on with-PM change path (Inspector Brad PR #71 high-severity find — sweep #1)", async () => {
    // Regression: when a user schedules a downgrade via Management
    // (no-PM path stamps `metadata.scheduled_change`) and then changes
    // tier via Selection with a new payment method, the with-PM change
    // path used to preserve the now-stale marker. `GET /subscriptions/
    // me` would keep returning it and the Selection screen would show
    // a phantom "Scheduled: <old downgrade target>" indicator over the
    // user's new tier.
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow({
        metadata: {
          stripe_customer_id: "cus_existing",
          stripe_subscription_id: "sub_old_active",
          scheduled_change: {
            next_tier_name: "basic",
            next_billing_cycle: "monthly",
            effective_at: "2026-12-01T00:00:00.000Z",
          },
        },
      }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_new_premium", status: "active" }),
    );
    await postCreate(validBody);
    const [, patch] = subscriptionRepositoryMocks.updateById.mock.calls[0];
    expect(
      (patch.metadata as Record<string, unknown>).scheduled_change,
    ).toBeUndefined();
    // The new old-sub marker IS present (replacing the stale scheduled_change).
    expect(
      (patch.metadata as Record<string, unknown>).old_stripe_subscription_id,
    ).toBe("sub_old_active");
  });

  it("does not grant a trial when user has already used user trial", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    profileRepositoryMocks.getById.mockResolvedValueOnce(
      fakeProfile({ hasUsedUserTrial: true }),
    );
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_no_trial",
        status: "active",
        trial_end: null as unknown as number,
      }),
    );
    await postCreate(validBody);
    const createCall = stripeMock.subscriptions.create.mock.calls[0][0];
    expect(createCall.trial_period_days).toBeUndefined();
    expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
  });

  it("returns requires_action with client_secret when the new sub needs 3DS", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_change_3ds",
        status: "incomplete",
        latest_invoice: {
          payment_intent: {
            status: "requires_action",
            client_secret: "pi_change_3ds_secret",
          },
        } as unknown as Stripe.Invoice,
      }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      success: true,
      requires_action: true,
      subscription_id: "us_existing",
      stripe_subscription_id: "sub_change_3ds",
      payment_status: "pending",
      client_secret: "pi_change_3ds_secret",
    });
    const [, patch] = subscriptionRepositoryMocks.updateById.mock.calls[0];
    expect(patch.paymentStatus).toBe("pending");
    expect((patch.metadata as Record<string, unknown>).requires_3d_secure).toBe(
      true,
    );
    // Trial flag flipped on 3DS path (anti-farming)
    expect(profileRepositoryMocks.update).toHaveBeenCalledWith("user-1", {
      hasUsedUserTrial: true,
    });
  });

  it("rolls back the new Stripe sub when the DB update fails", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_to_roll_back", status: "active" }),
    );
    subscriptionRepositoryMocks.updateById.mockRejectedValueOnce(
      new Error("neon transient"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_to_roll_back",
    );
    // Trial flag flip skipped on rollback
    expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("logs but does not error when Stripe rollback ALSO fails on change-path DB failure", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_double_fail", status: "active" }),
    );
    subscriptionRepositoryMocks.updateById.mockRejectedValueOnce(
      new Error("neon dead"),
    );
    stripeMock.subscriptions.cancel.mockRejectedValueOnce(
      new Error("stripe down"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Stripe rollback ALSO failed"),
    );
    errSpy.mockRestore();
  });

  it("rolls back when updateById returns null (existing row vanished between findMostRecent and the update)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_null_update", status: "active" }),
    );
    subscriptionRepositoryMocks.updateById.mockResolvedValueOnce(null);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_null_update",
    );
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("sub_null_update"),
    });
    errSpy.mockRestore();
  });

  it("logs but does not error when Stripe rollback ALSO fails after a null updateById", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_null_then_fail", status: "active" }),
    );
    subscriptionRepositoryMocks.updateById.mockResolvedValueOnce(null);
    stripeMock.subscriptions.cancel.mockRejectedValueOnce(
      new Error("stripe sick"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("ALSO failed"));
    errSpy.mockRestore();
  });

  it("returns 400 when PM attach fails on change path", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    const attachErr: any = new Error("expired card");
    attachErr.code = "card_expired";
    stripeMock.paymentMethods.attach.mockRejectedValueOnce(attachErr);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(400);
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns 500 when stripe.subscriptions.create throws on change path", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    stripeMock.subscriptions.create.mockRejectedValueOnce(
      new Error("price archived"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(subscriptionRepositoryMocks.updateById).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("flips hasUsedTrainerTrial on the change path for a trainer pro tier", async () => {
    mockPriceLookup({
      priceMonthly: "price_trainer_pro_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: true,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_change_to_trainer_pro",
        status: "trialing",
      }),
    );
    await postCreate({ ...validBody, tier_name: "individual_trainer_pro" });
    expect(profileRepositoryMocks.update).toHaveBeenCalledWith("user-1", {
      hasUsedTrainerTrial: true,
    });
  });

  it("tolerates null billingCycle on the existing row (reinstateable check uses 'monthly' default)", async () => {
    // Drizzle marks billingCycle as nullable on read — a legacy / out-of-band
    // row could carry null here. Eligibility check must fall through to
    // monthly by default rather than mis-classifying as not-reinstateable.
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow({ billingCycle: null }),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_old", status: "active" }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.update).toHaveBeenCalledWith(
      "sub_old",
      expect.any(Object),
    );
  });

  it("creates Stripe customer with undefined email/name when the profile has them null", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    profileRepositoryMocks.getById.mockResolvedValueOnce(
      fakeProfile({ email: null, fullName: null }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_null_profile" }),
    );
    await postCreate(validBody);
    expect(stripeMock.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: undefined,
        name: undefined,
      }),
    );
  });

  it("3DS branch returns client_secret=undefined when the Stripe PaymentIntent has null client_secret", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_3ds_no_secret",
        status: "incomplete",
        latest_invoice: {
          payment_intent: {
            status: "requires_action",
            client_secret: null,
          },
        } as unknown as Stripe.Invoice,
      }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.requires_action).toBe(true);
    expect(body.client_secret).toBeUndefined();
  });

  it("logs but does not error when trial flag update fails on change path", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_trial_flag_fail",
        status: "trialing",
      }),
    );
    profileRepositoryMocks.update.mockRejectedValueOnce(new Error("neon"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("trial flag update failed"),
    );
    errSpy.mockRestore();
  });
});

// ─── M10: deriveChangeType pure helper ──────────────────────────────

describe("subscriptionsCreateHandler — deriveChangeType (M10)", () => {
  it("classifies a tier change with higher new monthly price as upgrade (not scheduled)", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const result = __internals.deriveChangeType({
      oldTierName: "basic",
      newTierName: "premium",
      oldCycle: "monthly",
      newCycle: "monthly",
      oldPriceMonthly: 9.99,
      newPriceMonthly: 14.99,
      oldPriceYearly: 95.88,
      newPriceYearly: 143.88,
    });
    expect(result).toEqual({ changeType: "upgrade", isDowngrade: false });
  });

  it("classifies a tier change with lower new monthly price as downgrade (scheduled)", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const result = __internals.deriveChangeType({
      oldTierName: "premium",
      newTierName: "basic",
      oldCycle: "monthly",
      newCycle: "monthly",
      oldPriceMonthly: 14.99,
      newPriceMonthly: 9.99,
      oldPriceYearly: 143.88,
      newPriceYearly: 95.88,
    });
    expect(result).toEqual({ changeType: "downgrade", isDowngrade: true });
  });

  it("ties on equal monthly price default to upgrade (sibling-tier swap)", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const result = __internals.deriveChangeType({
      oldTierName: "basic",
      newTierName: "sibling",
      oldCycle: "monthly",
      newCycle: "monthly",
      oldPriceMonthly: 9.99,
      newPriceMonthly: 9.99,
      oldPriceYearly: null,
      newPriceYearly: null,
    });
    expect(result).toEqual({ changeType: "upgrade", isDowngrade: false });
  });

  it("classifies a monthly→yearly switch with cheaper annual cost as cycle_change downgrade", async () => {
    // monthly × 12 = £119.88; yearly = £95.88 → cycle change is a
    // downgrade in total annual spend.
    const { __internals } = await import("../subscriptionsCreateHandler");
    const result = __internals.deriveChangeType({
      oldTierName: "basic",
      newTierName: "basic",
      oldCycle: "monthly",
      newCycle: "yearly",
      oldPriceMonthly: 9.99,
      newPriceMonthly: 9.99,
      oldPriceYearly: 95.88,
      newPriceYearly: 95.88,
    });
    expect(result).toEqual({ changeType: "cycle_change", isDowngrade: true });
  });

  it("classifies a yearly→monthly switch with higher annual cost as cycle_change upgrade", async () => {
    // yearly = £95.88; switching to monthly = 9.99 × 12 = £119.88 → upgrade
    // in total annual spend.
    const { __internals } = await import("../subscriptionsCreateHandler");
    const result = __internals.deriveChangeType({
      oldTierName: "basic",
      newTierName: "basic",
      oldCycle: "yearly",
      newCycle: "monthly",
      oldPriceMonthly: 9.99,
      newPriceMonthly: 9.99,
      oldPriceYearly: 95.88,
      newPriceYearly: 95.88,
    });
    expect(result).toEqual({ changeType: "cycle_change", isDowngrade: false });
  });

  it("cycle_change falls back to monthly×12 when yearly is null", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    const result = __internals.deriveChangeType({
      oldTierName: "basic",
      newTierName: "basic",
      oldCycle: "monthly",
      newCycle: "yearly",
      oldPriceMonthly: 9.99,
      newPriceMonthly: 9.99,
      oldPriceYearly: null,
      newPriceYearly: null,
    });
    // Both sides fall back to monthly×12 = same → equal → upgrade default.
    expect(result.changeType).toBe("cycle_change");
    expect(result.isDowngrade).toBe(false);
  });
});

describe("subscriptionsCreateHandler — parseDecimal (M10)", () => {
  it("parses decimal strings, passes through numbers, returns null otherwise", async () => {
    const { __internals } = await import("../subscriptionsCreateHandler");
    expect(__internals.parseDecimal("9.99")).toBe(9.99);
    expect(__internals.parseDecimal(12.5)).toBe(12.5);
    expect(__internals.parseDecimal(null)).toBeNull();
    expect(__internals.parseDecimal(Number.NaN)).toBeNull();
    expect(__internals.parseDecimal(Number.POSITIVE_INFINITY)).toBeNull();
    expect(__internals.parseDecimal("garbage")).toBeNull();
  });
});

// ─── M10: response discriminator fields populated on every branch ───

describe("subscriptionsCreateHandler — response discriminators (M10)", () => {
  it("new-sub success populates change_type='new' / scheduled=false / effective_at=null / is_trial=(trialing)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_new", status: "trialing" }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      change_type: "new",
      scheduled: false,
      effective_at: null,
      is_trial: true,
    });
  });

  it("new-sub on 3DS path sets is_trial=false even though trial_period_days was requested", async () => {
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
        latest_invoice: {
          payment_intent: {
            status: "requires_action",
            client_secret: "pi_secret",
          },
        } as unknown as Stripe.Invoice,
      }),
    );
    const res = await postCreate(validBody);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      change_type: "new",
      scheduled: false,
      effective_at: null,
      is_trial: false,
      requires_action: true,
    });
  });

  it("reinstate success populates change_type='reinstate'", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      reinstateableRow(),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_old", status: "active" }),
    );
    const res = await postCreate(validBody);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      change_type: "reinstate",
      scheduled: false,
      effective_at: null,
      reinstated: true,
    });
  });

  it("with-PM change-path upgrade populates change_type='upgrade', scheduled=false, effective_at=null", async () => {
    // Existing row on `basic` @ 9.99 → switching to `premium` @ 14.99 is an upgrade.
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    // Existing tier price lookup (resolveTierPrices) — old "basic" @ 9.99
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_new", status: "active" }),
    );
    const res = await postCreate(validBody);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      change_type: "upgrade",
      scheduled: false,
      effective_at: null,
    });
  });

  it("with-PM change-path downgrade populates scheduled=true and effective_at from period end", async () => {
    // Existing row on `premium` @ 14.99 → switching to `basic` @ 9.99 is a downgrade.
    mockPriceLookup({
      priceMonthly: "price_basic_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "9.99",
      priceYearlyAmount: null,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "14.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow({ tierName: "premium" }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_new_basic",
        status: "active",
        items: {
          data: [{ current_period_end: 1735689600 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>, // 2026-01-01
      }),
    );
    const res = await postCreate({ ...validBody, tier_name: "basic" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      change_type: "downgrade",
      scheduled: true,
    });
    expect(body.effective_at).toBe(new Date(1735689600 * 1000).toISOString());
  });

  it("new-sub path handles non-Error rejections from stripe.subscriptions.create + DB insert + profile.update (covers defensive String() branches)", async () => {
    // Stripe.subscriptions.create non-Error reject
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "14.99",
      priceYearlyAmount: null,
    });
    stripeMock.subscriptions.create.mockRejectedValueOnce(
      "stripe-non-error-reject" as unknown as Error,
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("stripe-non-error-reject"),
    );
    errSpy.mockRestore();
  });

  it("new-sub path handles non-Error rejection from subRepo.insert (DB string-reject branch)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "14.99",
      priceYearlyAmount: null,
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_db_string_fail" }),
    );
    subscriptionRepositoryMocks.insert.mockRejectedValueOnce(
      "neon-non-error-reject" as unknown as Error,
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("neon-non-error-reject"),
    );
    errSpy.mockRestore();
  });

  it("change-path: handles non-Error rejection from attachPaymentMethod + null trial flags", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "14.99",
      priceYearlyAmount: null,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow(),
    );
    profileRepositoryMocks.getById.mockResolvedValueOnce(
      fakeProfile({ hasUsedUserTrial: null, hasUsedTrainerTrial: null }),
    );
    stripeMock.paymentMethods.attach.mockRejectedValueOnce(
      "attach-string-reject-change" as unknown as Error,
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(400);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("attach-string-reject-change"),
    );
    warnSpy.mockRestore();
  });

  it("handles non-Error rejection from attachPaymentMethod (new-sub path)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "14.99",
      priceYearlyAmount: null,
    });
    stripeMock.paymentMethods.attach.mockRejectedValueOnce(
      "attach-non-error-reject" as unknown as Error,
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(400);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("attach-non-error-reject"),
    );
    warnSpy.mockRestore();
  });

  it("treats null profile.has_used_*_trial as false (legacy/null-defaulted rows)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "14.99",
      priceYearlyAmount: null,
    });
    profileRepositoryMocks.getById.mockResolvedValueOnce(
      fakeProfile({
        hasUsedUserTrial: null,
        hasUsedTrainerTrial: null,
      }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_null_trial_flags",
        status: "trialing",
      }),
    );
    await postCreate(validBody);
    // null trial flag is treated as false → eligible for trial → flag flipped
    expect(profileRepositoryMocks.update).toHaveBeenCalledWith("user-1", {
      hasUsedUserTrial: true,
    });
  });

  it("new-sub path handles non-Error rejection from profileRepo.update on trial-flag flip", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "14.99",
      priceYearlyAmount: null,
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_trial_str_fail", status: "trialing" }),
    );
    profileRepositoryMocks.update.mockRejectedValueOnce(
      "trial-flag-non-error-reject" as unknown as Error,
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    // Trial flag failure is non-fatal — request still succeeds
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("trial-flag-non-error-reject"),
    );
    errSpy.mockRestore();
  });

  it("new-sub rollback handles a non-Error rejection from stripe.subscriptions.cancel (covers String() branch)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "14.99",
      priceYearlyAmount: null,
    });
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_rollback_non_error" }),
    );
    subscriptionRepositoryMocks.insert.mockRejectedValueOnce(
      new Error("neon timeout"),
    );
    // Non-Error rejection — exercises the `String(cancelErr)` branch in
    // the rollback's nested catch.
    stripeMock.subscriptions.cancel.mockRejectedValueOnce(
      "stripe-string-reject" as unknown as Error,
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(validBody);
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Stripe rollback ALSO failed"),
    );
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("stripe-string-reject"),
    );
    errSpy.mockRestore();
  });

  it("with-PM change-path defaults existing billingCycle to 'monthly' when null", async () => {
    // Legacy / out-of-band rows can carry a null billingCycle. The change
    // path must still classify the change correctly.
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "14.99",
      priceYearlyAmount: null,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow({ tierName: "basic", billingCycle: null }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_new", status: "active" }),
    );
    const res = await postCreate(validBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // basic@monthly → premium@monthly: tier change with higher price = upgrade
    expect(body.change_type).toBe("upgrade");
  });

  it("with-PM cycle change populates change_type='cycle_change'", async () => {
    // Same tier `basic`, different cycle.
    mockPriceLookup({
      priceMonthly: "price_basic_monthly",
      priceYearly: "price_basic_yearly",
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "9.99",
      priceYearlyAmount: "95.88",
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: "95.88" }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      changePathRow({ tierName: "basic", billingCycle: "monthly" }),
    );
    stripeMock.subscriptions.create.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_yearly", status: "active" }),
    );
    const res = await postCreate({
      ...validBody,
      tier_name: "basic",
      billing_cycle: "yearly",
    });
    const body = (await res.json()) as any;
    expect(body.change_type).toBe("cycle_change");
  });
});

// ─── M10: no-payment-method change-of-tier path ─────────────────────

describe("subscriptionsCreateHandler — no-payment-method change-path (M10)", () => {
  const noPmBody = {
    tier_name: "premium",
    billing_cycle: "monthly" as const,
    use_trial: false,
    // payment_method_id intentionally omitted
  };

  function existingActiveRow(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: "us_existing",
      userId: "user-1",
      tierName: "basic",
      billingCycle: "monthly",
      paymentStatus: "active",
      cancelledAt: null,
      metadata: {
        stripe_customer_id: "cus_existing",
        stripe_subscription_id: "sub_old_active",
      },
      ...over,
    };
  }

  it("returns 422 when no PM AND no active sub (precedence #2)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    // No findMostRecentForUser mock → null by default
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("payment_method_id required"),
    });
    // Nothing happened on Stripe
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
  });

  it("returns 400 when no PM + same tier + same cycle (precedence #3)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow({ tierName: "premium", billingCycle: "monthly" }),
    );
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("no change to apply"),
    });
  });

  it("routes no PM + different tier through subscriptions.update() (precedence #4) as upgrade", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    // existing tier price lookup → basic @ 9.99
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow(),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1700604800 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        status: "active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1700604800 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      change_type: "upgrade",
      scheduled: false,
      effective_at: null,
      stripe_subscription_id: "sub_old_active",
    });

    // No new sub created — only an update
    expect(stripeMock.subscriptions.create).not.toHaveBeenCalled();
    // attach should NOT be called either — no PM provided
    expect(stripeMock.paymentMethods.attach).not.toHaveBeenCalled();

    // The update call carries the item swap + always_invoice proration
    const updateArgs = stripeMock.subscriptions.update.mock.calls[0];
    expect(updateArgs[0]).toBe("sub_old_active");
    expect(updateArgs[1].items).toEqual([
      { id: "si_existing", price: "price_premium_monthly" },
    ]);
    expect(updateArgs[1].proration_behavior).toBe("always_invoice");

    // Local row patched in place, NOT inserted
    expect(subscriptionRepositoryMocks.insert).not.toHaveBeenCalled();
    expect(subscriptionRepositoryMocks.updateById).toHaveBeenCalled();
    const patch = subscriptionRepositoryMocks.updateById.mock.calls[0][1];
    expect(patch.tierName).toBe("premium");
    expect(patch.billingCycle).toBe("monthly");
  });

  it("routes no PM + downgrade (premium → basic) through subscriptions.update() with proration_behavior=none + billing_cycle_anchor=unchanged, stamps scheduled_change", async () => {
    mockPriceLookup({
      priceMonthly: "price_basic_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "9.99",
      priceYearlyAmount: null,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "14.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow({ tierName: "premium" }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1735689600 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        status: "active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1735689600 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    const res = await postCreate({ ...noPmBody, tier_name: "basic" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      change_type: "downgrade",
      scheduled: true,
    });
    expect(body.effective_at).toBe(new Date(1735689600 * 1000).toISOString());

    // Verify Stripe call shape — defer to period end
    const updateArgs = stripeMock.subscriptions.update.mock.calls[0][1];
    expect(updateArgs.proration_behavior).toBe("none");
    expect(updateArgs.billing_cycle_anchor).toBe("unchanged");

    // Local row keeps tier_name = premium until webhook flips it
    const patch = subscriptionRepositoryMocks.updateById.mock.calls[0][1];
    expect(patch.tierName).toBeUndefined();
    expect(patch.billingCycle).toBeUndefined();
    // But metadata.scheduled_change is stamped
    expect(patch.metadata.scheduled_change).toEqual({
      next_tier_name: "basic",
      next_billing_cycle: "monthly",
      effective_at: new Date(1735689600 * 1000).toISOString(),
    });
  });

  it("does not stamp scheduled_change when the resulting Stripe sub has no current_period_end", async () => {
    mockPriceLookup({
      priceMonthly: "price_basic_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "9.99",
      priceYearlyAmount: null,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "14.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow({ tierName: "premium" }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1700604800 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    // Updated sub has NO current_period_end on items — exercises the
    // `effectiveAtIso === null` else-branch where no scheduled_change is
    // stamped despite isDowngrade being true.
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        status: "active",
        items: {
          data: [],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    const res = await postCreate({ ...noPmBody, tier_name: "basic" });
    expect(res.status).toBe(200);
    const patch = subscriptionRepositoryMocks.updateById.mock.calls[0][1];
    expect(patch.metadata.scheduled_change).toBeUndefined();
  });

  it("clears a stale scheduled_change marker on downgrade even when new effectiveAtIso is null (Inspector Brad PR #71 medium-severity find — sweep #1)", async () => {
    // Regression: previously, the downgrade branch only wrote a new
    // scheduled_change when effectiveAtIso !== null — but did nothing
    // when it was null, leaving any prior marker intact. A second
    // downgrade attempt whose new Stripe sub returns no readable
    // current_period_end would silently keep the stale prior target.
    mockPriceLookup({
      priceMonthly: "price_basic_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "9.99",
      priceYearlyAmount: null,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "14.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow({
        tierName: "premium",
        metadata: {
          stripe_customer_id: "cus_existing",
          stripe_subscription_id: "sub_old_active",
          // STALE marker from a prior downgrade attempt that the
          // webhook hasn't yet resolved.
          scheduled_change: {
            next_tier_name: "free",
            next_billing_cycle: "monthly",
            effective_at: "2026-12-01T00:00:00.000Z",
          },
        },
      }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1700604800 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    // Updated sub has NO current_period_end on items — the
    // `effectiveAtIso === null` branch.
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        status: "active",
        items: {
          data: [],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    const res = await postCreate({ ...noPmBody, tier_name: "basic" });
    expect(res.status).toBe(200);
    const patch = subscriptionRepositoryMocks.updateById.mock.calls[0][1];
    // Stale marker MUST have been cleared even though no new one was
    // stamped.
    expect(patch.metadata.scheduled_change).toBeUndefined();
  });

  it("clears a stale scheduled_change marker when no-PM upgrade is requested", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow({
        metadata: {
          stripe_customer_id: "cus_existing",
          stripe_subscription_id: "sub_old_active",
          scheduled_change: {
            next_tier_name: "free",
            effective_at: "2026-12-01T00:00:00.000Z",
          },
        },
      }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1700604800 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        status: "active",
      }),
    );
    await postCreate(noPmBody);
    const patch = subscriptionRepositoryMocks.updateById.mock.calls[0][1];
    expect(patch.metadata.scheduled_change).toBeUndefined();
  });

  it("refuses no-PM dispatch when the in-flight marker guard fires (409)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow({
        metadata: {
          stripe_customer_id: "cus_existing",
          stripe_subscription_id: "sub_B_in_flight",
          old_stripe_subscription_id: "sub_A_orphaned",
        },
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(409);
    expect(stripeMock.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns 500 when stripe.subscriptions.retrieve fails", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow(),
    );
    stripeMock.subscriptions.retrieve.mockRejectedValueOnce(
      new Error("stripe 503"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("Failed to load existing subscription"),
    });
    expect(stripeMock.subscriptions.update).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("returns 500 when the existing Stripe sub has no items (cannot swap price)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow(),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        items: {
          data: [],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("no items on Stripe"),
    });
    errSpy.mockRestore();
  });

  it("returns 500 when stripe.subscriptions.update fails", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow(),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1700604800 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    stripeMock.subscriptions.update.mockRejectedValueOnce(
      new Error("stripe price archived"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("Failed to change subscription tier"),
    });
    errSpy.mockRestore();
  });

  it("returns 500 when DB update fails after Stripe-side change applied (no rollback)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow(),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1700604800 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_old_active", status: "active" }),
    );
    subscriptionRepositoryMocks.updateById.mockRejectedValueOnce(
      new Error("neon down"),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(500);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("manual backfill required"),
    );
    // Stripe.subscriptions.cancel must NOT be called — there's no fresh
    // sub to roll back, the original is intentionally still alive.
    expect(stripeMock.subscriptions.cancel).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("returns 500 when updateById returns null (row vanished between findMostRecent and update)", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow(),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1700604800 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_old_active", status: "active" }),
    );
    subscriptionRepositoryMocks.updateById.mockResolvedValueOnce(null);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("sub_old_active"),
    });
    errSpy.mockRestore();
  });

  it("returns 3DS shape when the updated Stripe sub's latest_invoice requires action", async () => {
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ priceMonthly: "9.99", priceYearly: null }],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow(),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1700604800 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        status: "incomplete",
        latest_invoice: {
          payment_intent: {
            status: "requires_action",
            client_secret: "pi_3ds_secret",
          },
        } as unknown as Stripe.Invoice,
      }),
    );
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      requires_action: true,
      payment_status: "pending",
      client_secret: "pi_3ds_secret",
      change_type: "upgrade",
    });
  });

  it("defaults billing_cycle to 'monthly' when existing row has it null (no-PM path)", async () => {
    // Drizzle's billingCycle column is nullable; pre-M10 / legacy rows
    // can carry null. Body says billing_cycle: monthly → if defaults to
    // monthly, dispatch case #3 fires (no change to apply, 400).
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
      priceMonthlyAmount: "14.99",
      priceYearlyAmount: null,
    });
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow({ tierName: "premium", billingCycle: null }),
    );
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("no change to apply"),
    });
  });

  it("tolerates a missing existing tier in the catalog by defaulting to upgrade", async () => {
    // resolveTierPrices for the old tier returns null (no row found),
    // the handler defaults the old-tier prices to 0 → new price > 0 →
    // upgrade.
    mockPriceLookup({
      priceMonthly: "price_premium_monthly",
      priceYearly: null,
      currency: "GBP",
      isTrainerTier: false,
    });
    // existing tier lookup returns empty (out-of-band data)
    dbSelectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }));
    subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValueOnce(
      existingActiveRow({ tierName: "ghost_tier" }),
    );
    stripeMock.subscriptions.retrieve.mockResolvedValueOnce(
      buildStripeSubscription({
        id: "sub_old_active",
        items: {
          data: [{ id: "si_existing", current_period_end: 1700604800 }],
        } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      }),
    );
    stripeMock.subscriptions.update.mockResolvedValueOnce(
      buildStripeSubscription({ id: "sub_old_active", status: "active" }),
    );
    const res = await postCreate(noPmBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.change_type).toBe("upgrade");
  });
});
