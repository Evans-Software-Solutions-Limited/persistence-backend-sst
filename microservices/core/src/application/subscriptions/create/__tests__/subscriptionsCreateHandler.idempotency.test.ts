/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  deriveSubscriptionBaseKey,
  opKey,
} from "../../../stripe/stripeIdempotency";

// ─── Module-level mocks (mirror subscriptionsCreateHandler.test.ts) ────

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
  customers: { retrieve: vi.fn(), create: vi.fn(), update: vi.fn() },
  paymentMethods: { attach: vi.fn() },
  subscriptions: {
    create: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    retrieve: vi.fn(),
  },
};
const dbSelectMock = vi.fn();

vi.mock("@persistence/db/client", () => ({
  getDb: () => ({ select: dbSelectMock }),
}));
vi.mock("@persistence/db", () => ({
  subscriptionTiers: {
    tierName: { name: "tier_name" },
    stripePriceIdMonthly: { name: "stripe_price_id_monthly" },
    stripePriceIdYearly: { name: "stripe_price_id_yearly" },
    currency: { name: "currency" },
    isTrainerTier: { name: "is_trainer_tier" },
    priceMonthly: { name: "price_monthly" },
    priceYearly: { name: "price_yearly" },
  },
}));
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) =>
    !authHeader || !authHeader.startsWith("Bearer ")
      ? null
      : {
          sub: "user-1",
          email: "t@e.com",
          email_verified: true,
          iat: 0,
          exp: 9e9,
        },
  ),
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

// ─── Helpers ───────────────────────────────────────────────────────────

function mockPriceLookup() {
  dbSelectMock.mockImplementationOnce(() => ({
    from: () => ({
      where: () => ({
        limit: async () => [
          {
            priceMonthly: "price_premium_m",
            priceYearly: null,
            currency: "GBP",
            isTrainerTier: false,
            priceMonthlyAmount: "12.99",
            priceYearlyAmount: null,
          },
        ],
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

async function postCreate(body: unknown) {
  const { subscriptionsCreateHandler } =
    await import("../subscriptionsCreateHandler");
  return subscriptionsCreateHandler.handle(
    new Request("http://localhost/subscriptions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify(body),
    }),
  );
}

const newSubBody = {
  tier_name: "premium",
  billing_cycle: "monthly" as const,
  payment_method_id: "pm_card",
  use_trial: false,
};

// Expected deterministic base key for `newSubBody` with no existing sub.
const expectedBase = deriveSubscriptionBaseKey({
  userId: "user-1",
  tierName: "premium",
  billingCycle: "monthly",
  paymentMethodId: "pm_card",
  existingExternalSubscriptionId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of [
    subscriptionRepositoryMocks.findMostRecentForUser,
    subscriptionRepositoryMocks.insert,
    subscriptionRepositoryMocks.updateById,
    profileRepositoryMocks.getById,
    profileRepositoryMocks.update,
    dbSelectMock,
    stripeMock.subscriptions.create,
    stripeMock.subscriptions.cancel,
    stripeMock.customers.create,
    stripeMock.customers.retrieve,
    stripeMock.customers.update,
    stripeMock.paymentMethods.attach,
  ]) {
    m.mockReset();
  }

  subscriptionRepositoryMocks.findMostRecentForUser.mockResolvedValue(null);
  subscriptionRepositoryMocks.insert.mockResolvedValue({ id: "us_new" });
  profileRepositoryMocks.getById.mockResolvedValue({
    id: "user-1",
    email: "t@e.com",
    fullName: "Test User",
    hasUsedUserTrial: false,
    hasUsedTrainerTrial: false,
  });
  profileRepositoryMocks.update.mockResolvedValue({});
  stripeMock.customers.create.mockResolvedValue({ id: "cus_new" });
  stripeMock.customers.update.mockResolvedValue({});
  stripeMock.paymentMethods.attach.mockResolvedValue({});
  stripeMock.subscriptions.create.mockResolvedValue(buildStripeSubscription());
  stripeMock.subscriptions.cancel.mockResolvedValue({});
  dbSelectMock.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: async () => [] }) }),
  }));
});

describe("subscriptionsCreateHandler — idempotency keys (spec 17 / Phase A)", () => {
  it("passes a deterministic idempotency key to every mutating Stripe call on the new-sub path", async () => {
    mockPriceLookup();
    const res = await postCreate(newSubBody);
    expect(res.status).toBe(200);

    // customers.create → opKey(base, "customer")
    expect(stripeMock.customers.create).toHaveBeenCalledWith(
      expect.any(Object),
      { idempotencyKey: opKey(expectedBase, "customer") },
    );
    // paymentMethods.attach → opKey(base, "pm-attach")
    expect(stripeMock.paymentMethods.attach).toHaveBeenCalledWith(
      "pm_card",
      expect.any(Object),
      { idempotencyKey: opKey(expectedBase, "pm-attach") },
    );
    // customers.update → opKey(base, "cust-update")
    expect(stripeMock.customers.update).toHaveBeenCalledWith(
      "cus_new",
      expect.any(Object),
      { idempotencyKey: opKey(expectedBase, "cust-update") },
    );
    // subscriptions.create → opKey(base, "sub-create")
    expect(stripeMock.subscriptions.create).toHaveBeenCalledWith(
      expect.any(Object),
      { idempotencyKey: opKey(expectedBase, "sub-create") },
    );
  });

  it("uses a client-supplied idempotency_key as the base when provided", async () => {
    mockPriceLookup();
    const res = await postCreate({ ...newSubBody, idempotency_key: "ck-123" });
    expect(res.status).toBe(200);
    expect(stripeMock.subscriptions.create).toHaveBeenCalledWith(
      expect.any(Object),
      { idempotencyKey: "ck-123:sub-create" },
    );
  });

  it("on a unique-violation (23505) at insert: cancels the orphan Stripe sub and returns 409", async () => {
    mockPriceLookup();
    subscriptionRepositoryMocks.insert.mockRejectedValueOnce({ code: "23505" });

    const res = await postCreate(newSubBody);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/already being set up/i);
    // Orphan Stripe sub must be cancelled so nothing keeps billing.
    expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith("sub_new");
  });

  it("on a non-unique insert error: still cancels the orphan but returns 500", async () => {
    mockPriceLookup();
    subscriptionRepositoryMocks.insert.mockRejectedValueOnce(
      new Error("connection reset"),
    );

    const res = await postCreate(newSubBody);

    expect(res.status).toBe(500);
    expect(stripeMock.subscriptions.cancel).toHaveBeenCalledWith("sub_new");
  });
});
