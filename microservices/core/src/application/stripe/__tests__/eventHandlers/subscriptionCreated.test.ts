/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const findByExternalIdMock = vi.fn();
const insertMock = vi.fn();

vi.mock("../../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi.fn().mockImplementation(() => ({
    findByExternalId: findByExternalIdMock,
    insert: insertMock,
  })),
}));

import {
  handleSubscriptionCreated,
  normaliseMetadataBillingCycle,
} from "../../eventHandlers/subscriptionCreated";

function buildEvent(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Event {
  const subscription = {
    id: "sub_new",
    customer: "cus_123",
    metadata: {
      supabase_user_id: "user-1",
      tier_name: "premium",
      billing_cycle: "monthly",
    },
    status: "trialing",
    created: 1700000000,
    trial_end: 1700604800,
    items: {
      data: [{ current_period_end: 1700604800 }],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
  return {
    id: "evt_test",
    type: "customer.subscription.created",
    data: { object: subscription },
  } as Stripe.Event;
}

describe("handleSubscriptionCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByExternalIdMock.mockResolvedValue(null);
    insertMock.mockResolvedValue({ id: "us_test" });
  });

  it("warns and skips when supabase_user_id is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleSubscriptionCreated(
      buildEvent({ metadata: {} } as Partial<Stripe.Subscription>),
    );
    expect(insertMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("idempotent-skips when a local row already exists for this external_subscription_id", async () => {
    findByExternalIdMock.mockResolvedValueOnce({
      id: "us_existing",
      externalSubscriptionId: "sub_new",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleSubscriptionCreated(buildEvent());
    expect(insertMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("already present"),
    );
    logSpy.mockRestore();
  });

  it("inserts a fresh row with fields sourced from the Stripe event", async () => {
    await handleSubscriptionCreated(buildEvent());
    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = insertMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      userId: "user-1",
      tierName: "premium",
      billingCycle: "monthly",
      paymentStatus: "trialing",
      externalSubscriptionId: "sub_new",
    });
    expect(payload.startsAt).toBeInstanceOf(Date);
    expect(payload.expiresAt).toBeInstanceOf(Date);
    expect(payload.trialEndsAt).toBeInstanceOf(Date);
    expect(payload.metadata).toMatchObject({
      stripe_customer_id: "cus_123",
      stripe_subscription_id: "sub_new",
    });
  });

  it("falls back to 'free' + 'monthly' when metadata.tier_name / billing_cycle are absent", async () => {
    // Post tier-simplification (20260526120000_simplify_tier_model.sql):
    // basic no longer exists. Defensive fallback is `free` — the most-
    // restrictive default so an unknown tier never accidentally grants
    // unlimited.
    await handleSubscriptionCreated(
      buildEvent({
        metadata: { supabase_user_id: "user-1" },
      } as Partial<Stripe.Subscription>),
    );
    const payload = insertMock.mock.calls[0][0];
    expect(payload.tierName).toBe("free");
    expect(payload.billingCycle).toBe("monthly");
  });

  it("extracts the customer id when subscription.customer is an object", async () => {
    await handleSubscriptionCreated(
      buildEvent({
        customer: { id: "cus_obj" } as any,
      }),
    );
    const payload = insertMock.mock.calls[0][0];
    expect(payload.metadata.stripe_customer_id).toBe("cus_obj");
  });

  it("skips + warns when the insert collides with the active-unique partial index (code 23505)", async () => {
    // Simulate the partial-unique-index violation: user already has an
    // active/pending row. Without the fix, the error would propagate to
    // the dispatcher → 500 → Stripe retries the same event for ~3 days.
    const pgError = Object.assign(new Error("duplicate key value"), {
      code: "23505",
    });
    insertMock.mockRejectedValueOnce(pgError);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      handleSubscriptionCreated(buildEvent()),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("collides with the active-unique constraint"),
    );
    warnSpy.mockRestore();
  });

  it("matches the constraint name in the error message when the code is buried in a cause chain", async () => {
    // postgres-js / Drizzle sometimes wrap the SQLSTATE inside a `cause`
    // chain rather than exposing it on the outer error. We fall back to
    // matching the constraint name literally.
    const wrapped = Object.assign(
      new Error(
        'Failed query: insert into user_subscriptions; duplicate key value violates unique constraint "user_subscriptions_active_unique"',
      ),
      { code: undefined },
    );
    insertMock.mockRejectedValueOnce(wrapped);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      handleSubscriptionCreated(buildEvent()),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("rethrows non-unique-violation errors so Stripe retries normally", async () => {
    insertMock.mockRejectedValueOnce(new Error("Neon: connection terminated"));
    await expect(handleSubscriptionCreated(buildEvent())).rejects.toThrow(
      /Neon: connection terminated/,
    );
  });
});

describe("handleSubscriptionCreated — Blue Light Card web subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByExternalIdMock.mockResolvedValue(null);
    insertMock.mockResolvedValue({ id: "us_blc" });
  });

  it("inserts the row the checkout's subscription_data.metadata describes", async () => {
    // The BLC checkout stamps the column's vocabulary (`yearly`) directly.
    await handleSubscriptionCreated(
      buildEvent({
        id: "sub_blc_1",
        status: "active",
        trial_end: null,
        metadata: {
          supabase_user_id: "user-blc",
          tier_name: "premium_plus",
          billing_cycle: "yearly",
          cadence: "annual",
          channel: "blc",
          voucher: "BLC-TEST",
          tduid: "td_1",
          campaign_slug: "",
        },
      } as Partial<Stripe.Subscription>),
    );
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      userId: "user-blc",
      tierName: "premium_plus",
      billingCycle: "yearly",
      paymentStatus: "active",
      externalSubscriptionId: "sub_blc_1",
      trialEndsAt: null,
    });
  });

  it("maps a web-style 'annual' to the column's 'yearly' rather than storing a value the app cannot read", async () => {
    // `normaliseBillingCycle` on the read side turns anything but
    // monthly/yearly into null — so an `annual` row would show no cycle.
    await handleSubscriptionCreated(
      buildEvent({
        metadata: {
          supabase_user_id: "user-blc",
          tier_name: "premium",
          billing_cycle: "annual",
        },
      } as Partial<Stripe.Subscription>),
    );
    expect(insertMock.mock.calls[0][0].billingCycle).toBe("yearly");
  });

  it("normalises the synonyms and keeps monthly as the default", () => {
    expect(normaliseMetadataBillingCycle("yearly")).toBe("yearly");
    expect(normaliseMetadataBillingCycle(" Annual ")).toBe("yearly");
    expect(normaliseMetadataBillingCycle("annually")).toBe("yearly");
    expect(normaliseMetadataBillingCycle("year")).toBe("yearly");
    expect(normaliseMetadataBillingCycle("monthly")).toBe("monthly");
    expect(normaliseMetadataBillingCycle("weekly")).toBe("monthly");
    expect(normaliseMetadataBillingCycle(undefined)).toBe("monthly");
  });
});
