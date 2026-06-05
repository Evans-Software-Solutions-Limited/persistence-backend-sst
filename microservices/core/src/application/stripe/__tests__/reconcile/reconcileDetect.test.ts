import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  diffSubscription,
  reconcileDetect,
  type LocalSubscriptionView,
} from "../../reconcile/reconcileDetect";

function sub(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "sub_1",
    status: "active",
    metadata: { supabase_user_id: "user-1" },
    canceled_at: null,
    cancel_at: null,
    items: {
      data: [
        {
          current_period_end: now + 30 * 86400,
          price: { id: "price_premium_m" },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("diffSubscription", () => {
  it("returns null (skip) when the sub has no supabase_user_id", () => {
    expect(diffSubscription(sub({ metadata: {} }), null, "premium")).toBeNull();
  });

  it("flags a missing local row for an active (non-terminal) sub", () => {
    const f = diffSubscription(sub({ status: "active" }), null, "premium");
    expect(f).toMatchObject({ kind: "missing_local_row", userId: "user-1" });
  });

  it("does NOT flag a missing local row for a terminal (canceled) sub", () => {
    expect(
      diffSubscription(sub({ status: "canceled" }), null, "premium"),
    ).toBeNull();
  });

  it("returns null when Stripe and local agree on status + tier", () => {
    const local: LocalSubscriptionView = {
      tierName: "premium",
      paymentStatus: "active",
    };
    expect(
      diffSubscription(sub({ status: "active" }), local, "premium"),
    ).toBeNull();
  });

  it("flags a payment_status mismatch", () => {
    const local: LocalSubscriptionView = {
      tierName: "premium",
      paymentStatus: "cancelled",
    };
    const f = diffSubscription(sub({ status: "active" }), local, "premium");
    expect(f?.kind).toBe("field_mismatch");
    expect(f?.fields).toEqual([
      { field: "payment_status", stripe: "active", local: "cancelled" },
    ]);
  });

  it("flags a tier mismatch only when the price resolves to a known tier", () => {
    const local: LocalSubscriptionView = {
      tierName: "free",
      paymentStatus: "active",
    };
    const flagged = diffSubscription(
      sub({ status: "active" }),
      local,
      "premium",
    );
    expect(flagged?.fields).toEqual([
      { field: "tier_name", stripe: "premium", local: "free" },
    ]);
    // Unresolved price (null) → tier not compared → no drift.
    expect(diffSubscription(sub({ status: "active" }), local, null)).toBeNull();
  });
});

describe("reconcileDetect", () => {
  async function* listOf(subs: Stripe.Subscription[]) {
    for (const s of subs) yield s;
  }

  it("aggregates counts and reports hasDrift across a mixed batch", async () => {
    const subs = [
      sub({ id: "sub_ok", status: "active" }), // agrees → ok
      sub({ id: "sub_missing", status: "active" }), // no local row → drift
      sub({ id: "sub_nouser", metadata: {} }), // no user → skipped
    ];
    const locals: Record<string, LocalSubscriptionView | null> = {
      sub_ok: { tierName: "premium", paymentStatus: "active" },
      sub_missing: null,
    };

    const result = await reconcileDetect({
      listSubscriptions: () => listOf(subs),
      findByExternalId: async (id) => locals[id] ?? null,
      resolveTierForPrice: async () => "premium",
    });

    expect(result.counts).toEqual({ total: 3, ok: 1, drift: 1, skipped: 1 });
    expect(result.hasDrift).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: "missing_local_row",
      stripeSubscriptionId: "sub_missing",
    });
  });

  it("reports hasDrift=false when everything agrees", async () => {
    const result = await reconcileDetect({
      listSubscriptions: () =>
        listOf([sub({ id: "sub_ok", status: "active" })]),
      findByExternalId: async () => ({
        tierName: "premium",
        paymentStatus: "active",
      }),
      resolveTierForPrice: async () => "premium",
    });
    expect(result.hasDrift).toBe(false);
    expect(result.counts.ok).toBe(1);
  });
});
