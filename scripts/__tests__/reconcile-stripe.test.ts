/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// The reconcile script reads env vars and a db client at module import
// time. The pure-helper tests don't need either, but `buildOp` exercises
// builds against Drizzle's $inferInsert type, so we mock the client.

// vi.mock factories are hoisted above all module-level code, so any vars
// they reference must be declared via vi.hoisted() to be available at
// hoist time. Without this, the closure capture fails with "Cannot
// access X before initialization".
const { getDbMock, stripeConstructorMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  stripeConstructorMock: vi.fn(),
}));

vi.mock("@persistence/db/client", () => ({
  getDb: getDbMock,
}));

// `reconcile` constructs a Stripe instance inside. Mock the module so
// the constructor returns a synthetic SDK we can drive.
vi.mock("stripe", () => ({
  default: stripeConstructorMock,
}));

import { __internals, reconcile } from "../reconcile-stripe";

const {
  parseArgs,
  mapStripeStatusToPaymentStatus,
  unixSecondsToDate,
  readCurrentPeriodEnd,
  readUserIdFromMetadata,
  readTierFromMetadata,
  readBillingCycleFromMetadata,
  readStripeCustomerId,
  buildOp,
  summarizeOp,
} = __internals;

function fakeSubscription(
  over: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
  return {
    id: "sub_test_123",
    status: "active",
    created: 1700000000,
    trial_end: null,
    canceled_at: null,
    customer: "cus_test_456",
    metadata: {
      supabase_user_id: "user-1",
      tier_name: "premium",
      billing_cycle: "monthly",
    },
    items: {
      data: [
        {
          current_period_end: 1717200000,
          price: { id: "price_premium_monthly" },
        },
      ],
    },
    ...over,
  } as unknown as Stripe.Subscription;
}

// Resolved tier shape — produced by the script's resolveTierForPrice
// against `subscription_tiers`. Tests pass this in directly so we don't
// need to mock the DB.
const tierPremiumMonthly = {
  tierName: "premium",
  billingCycle: "monthly" as const,
};

describe("reconcile-stripe — parseArgs", () => {
  it("defaults to dry-run on", () => {
    expect(parseArgs([])).toEqual({ dryRun: true, userId: null });
  });

  it("--write flips dry-run off", () => {
    expect(parseArgs(["--write"])).toEqual({ dryRun: false, userId: null });
  });

  it("--dry-run is accepted explicitly even though it's the default", () => {
    expect(parseArgs(["--dry-run"])).toEqual({ dryRun: true, userId: null });
  });

  it("--write takes precedence when both are passed", () => {
    expect(parseArgs(["--dry-run", "--write"])).toEqual({
      dryRun: false,
      userId: null,
    });
  });

  it("--user-id <value> picks up the value", () => {
    expect(parseArgs(["--user-id", "u123"])).toEqual({
      dryRun: true,
      userId: "u123",
    });
  });

  it("--user-id=<value> form also works", () => {
    expect(parseArgs(["--user-id=u-eq"])).toEqual({
      dryRun: true,
      userId: "u-eq",
    });
  });

  it("--user-id without a value throws", () => {
    expect(() => parseArgs(["--user-id"])).toThrow(/--user-id/);
  });
});

describe("reconcile-stripe — pure helpers", () => {
  it("mapStripeStatusToPaymentStatus covers all Stripe statuses", () => {
    expect(mapStripeStatusToPaymentStatus("trialing" as any)).toBe("trialing");
    expect(mapStripeStatusToPaymentStatus("active" as any)).toBe("active");
    expect(mapStripeStatusToPaymentStatus("past_due" as any)).toBe("past_due");
    expect(mapStripeStatusToPaymentStatus("canceled" as any)).toBe("cancelled");
    expect(mapStripeStatusToPaymentStatus("incomplete_expired" as any)).toBe(
      "cancelled",
    );
    expect(mapStripeStatusToPaymentStatus("unpaid" as any)).toBe("expired");
    expect(mapStripeStatusToPaymentStatus("incomplete" as any)).toBe("pending");
    expect(mapStripeStatusToPaymentStatus("paused" as any)).toBe("pending");
  });

  it("unixSecondsToDate handles 0, null, undefined, and positive", () => {
    expect(unixSecondsToDate(0)).toBeNull();
    expect(unixSecondsToDate(null)).toBeNull();
    expect(unixSecondsToDate(undefined)).toBeNull();
    expect(unixSecondsToDate(1700000000)?.toISOString()).toBe(
      new Date(1700000000 * 1000).toISOString(),
    );
  });

  it("readCurrentPeriodEnd prefers legacy top-level, falls back to items, returns null otherwise", () => {
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
    expect(readCurrentPeriodEnd({} as any)).toBeNull();
  });

  it("readUserIdFromMetadata returns null on missing or empty", () => {
    expect(readUserIdFromMetadata({ metadata: {} } as any)).toBeNull();
    expect(
      readUserIdFromMetadata({
        metadata: { supabase_user_id: "" },
      } as any),
    ).toBeNull();
    expect(
      readUserIdFromMetadata({
        metadata: { supabase_user_id: "u1" },
      } as any),
    ).toBe("u1");
  });

  it("readTierFromMetadata + readBillingCycleFromMetadata fall back to safe defaults", () => {
    expect(readTierFromMetadata({ metadata: {} } as any)).toBe("basic");
    expect(
      readTierFromMetadata({ metadata: { tier_name: "premium" } } as any),
    ).toBe("premium");
    expect(readBillingCycleFromMetadata({ metadata: {} } as any)).toBe(
      "monthly",
    );
    expect(
      readBillingCycleFromMetadata({
        metadata: { billing_cycle: "yearly" },
      } as any),
    ).toBe("yearly");
  });

  it("readStripeCustomerId handles both string and expanded forms", () => {
    expect(readStripeCustomerId({ customer: "cus_abc" } as any)).toBe(
      "cus_abc",
    );
    expect(readStripeCustomerId({ customer: { id: "cus_xyz" } } as any)).toBe(
      "cus_xyz",
    );
  });

  it("readStripePriceCurrency reads from price + uppercases (Inspector Brad PR #70 sweep #6)", () => {
    const { readStripePriceCurrency } = __internals;
    // Stripe stores currency lowercase; we uppercase to match the
    // `user_subscriptions.currency` column convention.
    expect(
      readStripePriceCurrency({
        items: { data: [{ price: { currency: "usd" } }] },
      } as any),
    ).toBe("USD");
    expect(
      readStripePriceCurrency({
        items: { data: [{ price: { currency: "EUR" } }] },
      } as any),
    ).toBe("EUR");
    // Missing → null so caller can omit from the patch
    expect(readStripePriceCurrency({} as any)).toBeNull();
    expect(
      readStripePriceCurrency({ items: { data: [{}] } } as any),
    ).toBeNull();
    expect(
      readStripePriceCurrency({
        items: { data: [{ price: { currency: "" } }] },
      } as any),
    ).toBeNull();
  });
});

describe("reconcile-stripe — buildOp", () => {
  it("returns skip when supabase_user_id metadata is missing", () => {
    const op = buildOp(
      fakeSubscription({ metadata: {} }),
      null,
      tierPremiumMonthly,
    );
    expect(op).toEqual({
      op: "skip",
      reason: "missing supabase_user_id metadata",
      stripeId: "sub_test_123",
    });
  });

  it("skips inserting a phantom row for a permanently-canceled Stripe sub with no matching local row (Inspector Brad PR #70 sweep #3)", () => {
    // Regression: previously the script would INSERT a fresh local row
    // for any historical canceled Stripe sub, with createdAt=now()
    // because the payload omitted createdAt and the schema's defaultNow
    // fired. findMostRecentForUser's createdAt-DESC ordering then
    // returned that phantom as the user's "most recent" row, breaking
    // subsequent subscribes via active-unique-index collision.
    const op = buildOp(
      fakeSubscription({ status: "canceled" }),
      null,
      tierPremiumMonthly,
    );
    expect(op.op).toBe("skip");
    if (op.op !== "skip") return;
    expect(op.reason).toContain("terminal Stripe status");
    expect(op.reason).toContain("canceled");
  });

  it("skips inserting a phantom row for incomplete_expired Stripe subs with no matching local row", () => {
    const op = buildOp(
      fakeSubscription({ status: "incomplete_expired" }),
      null,
      tierPremiumMonthly,
    );
    expect(op.op).toBe("skip");
  });

  it("still UPDATES a local row when the matching Stripe sub is canceled (terminal-skip applies to INSERT branch only)", () => {
    // A locally-known canceled sub is the user's real cancelled state —
    // we should mirror Stripe into it, not skip. Use canceled_at + a
    // past period_end so the grace-period check resolves to "cancelled"
    // rather than "active" (sweep #4 grace-period mapping).
    const op = buildOp(
      fakeSubscription({
        status: "canceled",
        canceled_at: 1700000000,
        items: {
          data: [
            {
              current_period_end: 1700604800, // also in the past
              price: { id: "price_premium_monthly" },
            },
          ],
        } as unknown as Stripe.Subscription["items"],
      }),
      {
        id: "us_known_cancelled",
        userId: "user-1",
        tierName: "premium",
        billingCycle: "monthly",
        paymentStatus: "active",
        startsAt: new Date(),
        expiresAt: null,
        cancelledAt: null,
        trialEndsAt: null,
        nextBillingDate: null,
        externalSubscriptionId: "sub_test_123",
        metadata: {},
        currency: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      tierPremiumMonthly,
    );
    expect(op.op).toBe("update");
    if (op.op !== "update") return;
    expect(op.patch.paymentStatus).toBe("cancelled");
  });

  it("builds an insert op when no local row exists", () => {
    const op = buildOp(fakeSubscription(), null, tierPremiumMonthly);
    expect(op.op).toBe("insert");
    if (op.op !== "insert") return;
    expect(op.userId).toBe("user-1");
    expect(op.payload).toMatchObject({
      userId: "user-1",
      tierName: "premium",
      billingCycle: "monthly",
      paymentStatus: "active",
      externalSubscriptionId: "sub_test_123",
    });
    expect(op.payload.expiresAt).toEqual(new Date(1717200000 * 1000));
    // Preserve Stripe's `created` as the local createdAt (Inspector
    // Brad PR #70 sweep #3) — otherwise the schema's defaultNow would
    // fire and the row would skew "now" in findMostRecentForUser's
    // createdAt-DESC ordering.
    expect(op.payload.createdAt).toEqual(new Date(1700000000 * 1000));
    expect((op.payload.metadata as any).stripe_customer_id).toBe(
      "cus_test_456",
    );
    expect((op.payload.metadata as any).reconciled_at).toEqual(
      expect.any(String),
    );
  });

  it("builds an update op when a local row already exists, preserving prior metadata", () => {
    const op = buildOp(
      fakeSubscription({ status: "past_due" }),
      {
        id: "us_local_1",
        userId: "user-1",
        tierName: "basic",
        billingCycle: "monthly",
        paymentStatus: "active",
        startsAt: new Date(),
        expiresAt: null,
        cancelledAt: null,
        trialEndsAt: null,
        nextBillingDate: null,
        externalSubscriptionId: "sub_test_123",
        metadata: {
          stripe_customer_id: "cus_old",
          platform: "ios",
        },
        currency: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      tierPremiumMonthly,
    );
    expect(op.op).toBe("update");
    if (op.op !== "update") return;
    expect(op.localId).toBe("us_local_1");
    expect(op.patch).toMatchObject({
      tierName: "premium",
      billingCycle: "monthly",
      paymentStatus: "past_due",
    });
    expect((op.patch.metadata as any).platform).toBe("ios");
    expect((op.patch.metadata as any).stripe_customer_id).toBe("cus_test_456");
  });

  it("update op writes cancelledAt when Stripe reports a canceled_at", () => {
    const op = buildOp(
      fakeSubscription({
        status: "canceled",
        canceled_at: 1710000000,
        items: {
          data: [
            {
              current_period_end: 1700000000, // past — so grace expired
              price: { id: "price_premium_monthly" },
            },
          ],
        } as unknown as Stripe.Subscription["items"],
      }),
      {
        id: "us_local_2",
        userId: "user-1",
        externalSubscriptionId: "sub_test_123",
        metadata: {},
      } as any,
      tierPremiumMonthly,
    );
    expect(op.op).toBe("update");
    if (op.op !== "update") return;
    expect(op.patch.paymentStatus).toBe("cancelled");
    expect(op.patch.cancelledAt).toEqual(new Date(1710000000 * 1000));
  });

  // ─── Sweep #4 regressions ──────────────────────────────────────────

  it("does NOT silently downgrade tier to 'basic'/'monthly' when Stripe metadata is missing tier_name (Inspector Brad PR #70 sweep #4 high)", () => {
    // Previously the script wrote `tier_name: "basic"` and `billing_cycle:
    // "monthly"` defaults straight onto an existing premium/yearly row
    // when Stripe metadata was missing — and the DB trigger would
    // re-derive profiles.role + subscription_limits against the wrong
    // tier, silently downgrading the user.
    //
    // Fix: resolve tier+cycle from the price id via subscription_tiers.
    // Caller passes a non-null tierFromPrice here, so the patch uses
    // those values rather than the metadata defaults.
    const op = buildOp(
      fakeSubscription({
        // No tier_name / billing_cycle in metadata at all
        metadata: { supabase_user_id: "user-1" },
      }),
      {
        id: "us_premium_yearly",
        userId: "user-1",
        tierName: "premium",
        billingCycle: "yearly",
        paymentStatus: "active",
        startsAt: new Date(),
        expiresAt: null,
        cancelledAt: null,
        trialEndsAt: null,
        nextBillingDate: null,
        externalSubscriptionId: "sub_test_123",
        metadata: {},
        currency: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      { tierName: "premium", billingCycle: "yearly" }, // resolved from price id
    );
    expect(op.op).toBe("update");
    if (op.op !== "update") return;
    expect(op.patch.tierName).toBe("premium");
    expect(op.patch.billingCycle).toBe("yearly");
  });

  it("falls back to metadata with a warning when price-id lookup misses (defensive — Inspector Brad PR #70 sweep #4)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const op = buildOp(
      fakeSubscription({
        metadata: {
          supabase_user_id: "user-1",
          tier_name: "individual_trainer_pro",
          billing_cycle: "monthly",
        },
      }),
      null,
      null, // price-id lookup missed
    );
    expect(op.op).toBe("insert");
    if (op.op !== "insert") return;
    expect(op.payload.tierName).toBe("individual_trainer_pro");
    expect(op.payload.billingCycle).toBe("monthly");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("price-id lookup missed"),
    );
    warnSpy.mockRestore();
  });

  it("skips the op entirely when BOTH price-id lookup AND metadata are missing — never silently writes basic/monthly", () => {
    const op = buildOp(
      fakeSubscription({
        // No tier metadata, and caller couldn't resolve from price
        metadata: { supabase_user_id: "user-1" },
      }),
      null,
      null,
    );
    expect(op.op).toBe("skip");
    if (op.op !== "skip") return;
    expect(op.reason).toContain("cannot resolve tier");
  });

  it("preserves 'active' for an in-grace-period cancel-at-period-end sub instead of flipping to 'cancelled' (Inspector Brad PR #70 sweep #4 medium)", async () => {
    // Regression: previously the script used the bare
    // mapStripeStatusToPaymentStatus which mapped canceled →
    // "cancelled" unconditionally. The webhook handler uses the
    // grace-period-aware ForUpdate variant, which preserves "active"
    // while canceled_at is set AND current_period_end is in the
    // future. Reconcile diverging from the webhook would let the DB
    // trigger revoke profiles.role early and pull access before the
    // user-paid period ends. Reconcile now mirrors the ForUpdate
    // semantics.
    const futureSeconds = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const op = buildOp(
      fakeSubscription({
        status: "canceled",
        canceled_at: Math.floor(Date.now() / 1000) - 60 * 60,
        items: {
          data: [
            {
              current_period_end: futureSeconds,
              price: { id: "price_premium_monthly" },
            },
          ],
        } as unknown as Stripe.Subscription["items"],
      }),
      {
        id: "us_in_grace",
        userId: "user-1",
        tierName: "premium",
        billingCycle: "monthly",
        paymentStatus: "active",
        startsAt: new Date(),
        expiresAt: null,
        cancelledAt: null,
        trialEndsAt: null,
        nextBillingDate: null,
        externalSubscriptionId: "sub_test_123",
        metadata: {},
        currency: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      tierPremiumMonthly,
    );
    expect(op.op).toBe("update");
    if (op.op !== "update") return;
    // Grace period still active → payment_status stays "active"
    expect(op.patch.paymentStatus).toBe("active");
    // But cancelledAt is still stamped so the UI can render
    // "Active until DD-MM"
    expect(op.patch.cancelledAt).not.toBeNull();
  });

  it("INSERT payload includes Stripe price currency (uppercase) instead of falling back to the schema's GBP default (Inspector Brad PR #70 sweep #6)", () => {
    const op = buildOp(
      fakeSubscription({
        items: {
          data: [
            {
              current_period_end: 1717200000,
              price: { id: "price_premium_monthly", currency: "usd" },
            },
          ],
        } as unknown as Stripe.Subscription["items"],
      }),
      null,
      tierPremiumMonthly,
    );
    expect(op.op).toBe("insert");
    if (op.op !== "insert") return;
    expect(op.payload.currency).toBe("USD");
  });

  it("UPDATE patch includes Stripe price currency too — not just on INSERT", () => {
    const op = buildOp(
      fakeSubscription({
        items: {
          data: [
            {
              current_period_end: 1717200000,
              price: { id: "price_premium_monthly", currency: "eur" },
            },
          ],
        } as unknown as Stripe.Subscription["items"],
      }),
      {
        id: "us_local_currency",
        userId: "user-1",
        tierName: "premium",
        billingCycle: "monthly",
        paymentStatus: "active",
        startsAt: new Date(),
        expiresAt: null,
        cancelledAt: null,
        trialEndsAt: null,
        nextBillingDate: null,
        externalSubscriptionId: "sub_test_123",
        metadata: {},
        currency: "GBP", // wrong — should be overwritten by reconcile
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      tierPremiumMonthly,
    );
    expect(op.op).toBe("update");
    if (op.op !== "update") return;
    expect(op.patch.currency).toBe("EUR");
  });

  it("omits currency from patch when Stripe price has no currency — preserves existing column rather than nulling it", () => {
    const op = buildOp(
      fakeSubscription({
        items: {
          data: [
            {
              current_period_end: 1717200000,
              price: { id: "price_premium_monthly" }, // no currency field
            },
          ],
        } as unknown as Stripe.Subscription["items"],
      }),
      {
        id: "us_no_currency",
        userId: "user-1",
        tierName: "premium",
        billingCycle: "monthly",
        paymentStatus: "active",
        startsAt: new Date(),
        expiresAt: null,
        cancelledAt: null,
        trialEndsAt: null,
        nextBillingDate: null,
        externalSubscriptionId: "sub_test_123",
        metadata: {},
        currency: "GBP",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      tierPremiumMonthly,
    );
    expect(op.op).toBe("update");
    if (op.op !== "update") return;
    // patch does NOT contain a `currency` key — Drizzle will leave the
    // column alone on UPDATE, preserving whatever was there before.
    expect("currency" in op.patch).toBe(false);
  });

  it("flips to 'cancelled' once the grace period has expired", () => {
    const pastSeconds = Math.floor(Date.now() / 1000) - 60 * 60;
    const op = buildOp(
      fakeSubscription({
        status: "canceled",
        canceled_at: pastSeconds - 60 * 60,
        items: {
          data: [
            {
              current_period_end: pastSeconds,
              price: { id: "price_premium_monthly" },
            },
          ],
        } as unknown as Stripe.Subscription["items"],
      }),
      {
        id: "us_grace_expired",
        userId: "user-1",
        tierName: "premium",
        billingCycle: "monthly",
        paymentStatus: "active",
        startsAt: new Date(),
        expiresAt: null,
        cancelledAt: null,
        trialEndsAt: null,
        nextBillingDate: null,
        externalSubscriptionId: "sub_test_123",
        metadata: {},
        currency: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      tierPremiumMonthly,
    );
    expect(op.op).toBe("update");
    if (op.op !== "update") return;
    expect(op.patch.paymentStatus).toBe("cancelled");
  });
});

describe("reconcile-stripe — summarizeOp", () => {
  it("formats a skip line", () => {
    const out = summarizeOp({
      op: "skip",
      reason: "missing metadata",
      stripeId: "sub_x",
    });
    expect(out).toContain("SKIP");
    expect(out).toContain("sub_x");
    expect(out).toContain("missing metadata");
  });

  it("formats an insert line", () => {
    const out = summarizeOp({
      op: "insert",
      stripeId: "sub_new",
      userId: "u1",
      payload: { paymentStatus: "active", tierName: "premium" } as any,
    });
    expect(out).toContain("INSERT");
    expect(out).toContain("sub_new");
    expect(out).toContain("u1");
    expect(out).toContain("active");
  });

  it("formats an update line", () => {
    const out = summarizeOp({
      op: "update",
      stripeId: "sub_upd",
      userId: "u1",
      localId: "us_1",
      patch: { paymentStatus: "past_due", tierName: "premium" } as any,
    });
    expect(out).toContain("UPDATE");
    expect(out).toContain("us_1");
    expect(out).toContain("past_due");
  });
});

// ─── reconcile() — applied / failed counters ─────────────────────────

describe("reconcile() applied/failed counters (Inspector Brad PR #70 sweep #5)", () => {
  // Drive `reconcile()` end-to-end via top-level Stripe + DB mocks so
  // we can assert that planned counts (skip/insert/update/total) and
  // actually-applied counts (applied/failed) diverge correctly when
  // some applyOp calls fail.

  function makeAsyncIterable<T>(items: T[]): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          next() {
            if (i < items.length) {
              return Promise.resolve({ value: items[i++], done: false });
            }
            return Promise.resolve({ value: undefined as any, done: true });
          },
        };
      },
    };
  }

  function buildPremiumSubscription(
    overrides: Partial<Stripe.Subscription> = {},
  ): Stripe.Subscription {
    return {
      id: "sub_seed",
      status: "active",
      created: 1700000000,
      trial_end: null,
      canceled_at: null,
      customer: "cus_seed",
      metadata: {
        supabase_user_id: "user-1",
        tier_name: "premium",
        billing_cycle: "monthly",
      },
      items: {
        data: [
          {
            current_period_end: 1717200000,
            price: { id: "price_premium_monthly" },
          },
        ],
      },
      ...overrides,
    } as unknown as Stripe.Subscription;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.DATABASE_URL = "postgres://test";
  });

  it("tracks applied/failed separately from planned, surfacing DB-side errors that previously sailed through as 'COMMITTED'", async () => {
    // Two subscriptions in the Stripe page — both planned as UPDATEs
    // (matching local rows). One DB update succeeds; one throws.
    const subOk = buildPremiumSubscription({ id: "sub_ok" });
    const subFails = buildPremiumSubscription({ id: "sub_fails" });

    stripeConstructorMock.mockImplementation(() => ({
      subscriptions: {
        list: () => makeAsyncIterable([subOk, subFails]),
      },
    }));

    // findByExternalId returns a local row for both → both routed to
    // UPDATE branch in buildOp. (subscriptionTiers price lookup is the
    // FIRST SELECT call in the loop, then findByExternalId. Order
    // matters for our mock sequence.)
    const limitOk = vi.fn().mockResolvedValue([{ id: "us_ok" }]);
    const limitFails = vi.fn().mockResolvedValue([{ id: "us_fails" }]);
    const limitPriceOk = vi.fn().mockResolvedValue([
      {
        tierName: "premium",
        monthly: "price_premium_monthly",
        yearly: null,
      },
    ]);
    const limitPriceFails = vi.fn().mockResolvedValue([
      {
        tierName: "premium",
        monthly: "price_premium_monthly",
        yearly: null,
      },
    ]);

    const select = vi
      .fn()
      // sub_ok: 1st call is the price-id lookup (resolveTierForPrice),
      // 2nd is findByExternalId
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: limitPriceOk }) }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: limitOk }) }),
      })
      // sub_fails: same order
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: limitPriceFails }) }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: limitFails }) }),
      });

    // applyOp does a Drizzle update on the user_subscriptions table.
    // For sub_ok we resolve cleanly; for sub_fails we throw.
    const updateChainOk = {
      set: () => ({ where: () => Promise.resolve() }),
    };
    const updateChainFails = {
      set: () => ({
        where: () => Promise.reject(new Error("neon transient")),
      }),
    };
    const update = vi
      .fn()
      .mockReturnValueOnce(updateChainOk)
      .mockReturnValueOnce(updateChainFails);

    getDbMock.mockReturnValue({ select, update });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { counts } = await reconcile({ dryRun: false, userId: null });

    expect(counts.total).toBe(2);
    expect(counts.update).toBe(2); // both planned as UPDATEs
    expect(counts.applied).toBe(1); // only sub_ok actually landed
    expect(counts.failed).toBe(1); // sub_fails errored
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("apply failed"),
    );

    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("does NOT increment applied or failed on dry-run mode (no DB writes attempted)", async () => {
    const sub = buildPremiumSubscription();
    stripeConstructorMock.mockImplementation(() => ({
      subscriptions: {
        list: () => makeAsyncIterable([sub]),
      },
    }));

    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                tierName: "premium",
                monthly: "price_premium_monthly",
                yearly: null,
              },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([{ id: "us_ok" }]),
          }),
        }),
      });
    const update = vi.fn();
    getDbMock.mockReturnValue({ select, update });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { counts } = await reconcile({ dryRun: true, userId: null });

    expect(counts.total).toBe(1);
    expect(counts.update).toBe(1);
    expect(counts.applied).toBe(0);
    expect(counts.failed).toBe(0);
    expect(update).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("does NOT count skip ops as applied or failed (they have no apply step)", async () => {
    // Sub with no supabase_user_id metadata → buildOp returns skip
    const sub = buildPremiumSubscription({
      id: "sub_skip",
      metadata: {}, // missing user id
    });
    stripeConstructorMock.mockImplementation(() => ({
      subscriptions: {
        list: () => makeAsyncIterable([sub]),
      },
    }));

    const select = vi.fn().mockReturnValue({
      from: () => ({
        where: () => ({
          // price lookup returns empty, findByExternalId returns empty
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const update = vi.fn();
    getDbMock.mockReturnValue({ select, update });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { counts } = await reconcile({ dryRun: false, userId: null });

    expect(counts.skip).toBe(1);
    expect(counts.applied).toBe(0);
    expect(counts.failed).toBe(0);
    expect(update).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
