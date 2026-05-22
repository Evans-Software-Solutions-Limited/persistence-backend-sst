/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// The reconcile script reads env vars and a db client at module import
// time. The pure-helper tests don't need either, but `buildOp` exercises
// builds against Drizzle's $inferInsert type, so we mock the client.

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { __internals } from "../reconcile-stripe";

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
    items: { data: [{ current_period_end: 1717200000 }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

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
});

describe("reconcile-stripe — buildOp", () => {
  it("returns skip when supabase_user_id metadata is missing", () => {
    const op = buildOp(fakeSubscription({ metadata: {} }), null);
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
    const op = buildOp(fakeSubscription({ status: "canceled" }), null);
    expect(op.op).toBe("skip");
    if (op.op !== "skip") return;
    expect(op.reason).toContain("terminal Stripe status");
    expect(op.reason).toContain("canceled");
  });

  it("skips inserting a phantom row for incomplete_expired Stripe subs with no matching local row", () => {
    const op = buildOp(
      fakeSubscription({ status: "incomplete_expired" }),
      null,
    );
    expect(op.op).toBe("skip");
  });

  it("still UPDATES a local row when the matching Stripe sub is canceled (terminal-skip applies to INSERT branch only)", () => {
    // A locally-known canceled sub is the user's real cancelled state —
    // we should mirror Stripe into it, not skip.
    const op = buildOp(fakeSubscription({ status: "canceled" }), {
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
    } as any);
    expect(op.op).toBe("update");
    if (op.op !== "update") return;
    expect(op.patch.paymentStatus).toBe("cancelled");
  });

  it("builds an insert op when no local row exists", () => {
    const op = buildOp(fakeSubscription(), null);
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
    const op = buildOp(fakeSubscription({ status: "past_due" }), {
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
    } as any);
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
      }),
      {
        id: "us_local_2",
        userId: "user-1",
        externalSubscriptionId: "sub_test_123",
        metadata: {},
      } as any,
    );
    expect(op.op).toBe("update");
    if (op.op !== "update") return;
    expect(op.patch.paymentStatus).toBe("cancelled");
    expect(op.patch.cancelledAt).toEqual(new Date(1710000000 * 1000));
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
