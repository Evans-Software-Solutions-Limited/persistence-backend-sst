import { describe, expect, it } from "vitest";
import {
  billingCycleFromPeriodMs,
  pickDesiredSubscription,
  rcEntitlementToTier,
  type NormalizedSubscription,
} from "../entitlements";

describe("rcEntitlementToTier", () => {
  it("maps the known consumer + entry-coach entitlement ids to their tiers", () => {
    expect(rcEntitlementToTier("premium")).toBe("premium");
    expect(rcEntitlementToTier("individual_trainer")).toBe(
      "individual_trainer",
    );
  });

  it("maps the premium_plus entitlement id to its tier (M19-P0)", () => {
    expect(rcEntitlementToTier("premium_plus")).toBe("premium_plus");
  });

  // Spec-29 Phase 2 coach ladder (2026-08-05): the three new coach-tier
  // entitlement ids must round-trip, and coach_pro must NOT be shadowed by
  // the "coach" case above it in the switch.
  it("maps the three new coach-ladder entitlement ids to their tiers", () => {
    expect(rcEntitlementToTier("start_up_coach_plus")).toBe(
      "start_up_coach_plus",
    );
    expect(rcEntitlementToTier("coach")).toBe("coach");
    expect(rcEntitlementToTier("coach_pro")).toBe("coach_pro");
  });

  it("returns null for unknown / free ids (forward-compatible)", () => {
    expect(rcEntitlementToTier("free")).toBeNull();
    expect(rcEntitlementToTier("something_new")).toBeNull();
    expect(rcEntitlementToTier("")).toBeNull();
  });
});

describe("billingCycleFromPeriodMs", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("defaults to monthly when either bound is null", () => {
    expect(billingCycleFromPeriodMs(null, 1)).toBe("monthly");
    expect(billingCycleFromPeriodMs(1, null)).toBe("monthly");
    expect(billingCycleFromPeriodMs(null, null)).toBe("monthly");
  });

  it("treats a ~monthly span as monthly", () => {
    expect(billingCycleFromPeriodMs(0, 30 * DAY)).toBe("monthly");
    // Sandbox compresses periods — a 1-day span still reads monthly.
    expect(billingCycleFromPeriodMs(1784721019000, 1784807419000)).toBe(
      "monthly",
    );
  });

  it("treats a span over ~6 months as yearly", () => {
    expect(billingCycleFromPeriodMs(0, 365 * DAY)).toBe("yearly");
    expect(billingCycleFromPeriodMs(0, 200 * DAY)).toBe("yearly");
  });
});

describe("pickDesiredSubscription", () => {
  const sub = (
    over: Partial<NormalizedSubscription> = {},
  ): NormalizedSubscription => ({
    tier: "premium",
    expiresAt: null,
    billingCycle: "monthly",
    productId: null,
    store: null,
    autoRenewOff: false,
    ...over,
  });

  it("returns null when there are no access-granting subscriptions", () => {
    expect(pickDesiredSubscription([])).toBeNull();
  });

  it("returns the single subscription's derived state", () => {
    const expiresAt = new Date("2026-07-01T00:00:00.000Z");
    const result = pickDesiredSubscription([
      sub({
        tier: "individual_trainer",
        expiresAt,
        billingCycle: "yearly",
        productId: "prod1a5681d5cd",
        store: "app_store",
        autoRenewOff: true,
      }),
    ]);
    expect(result).toEqual({
      tier: "individual_trainer",
      expiresAt,
      billingCycle: "yearly",
      productId: "prod1a5681d5cd",
      store: "app_store",
      autoRenewOff: true,
    });
  });

  it("picks the highest-ranked tier when multiple are active", () => {
    const result = pickDesiredSubscription([
      sub({ tier: "premium" }),
      sub({ tier: "coach_pro" }),
      sub({ tier: "individual_trainer" }),
    ]);
    expect(result?.tier).toBe("coach_pro");
  });

  it("breaks a same-tier tie by the latest expiry (Brad's two sandbox subs)", () => {
    const earlier = new Date(1784760339000);
    const later = new Date(1784807419000);
    const result = pickDesiredSubscription([
      sub({ tier: "individual_trainer", expiresAt: earlier, store: "early" }),
      sub({ tier: "individual_trainer", expiresAt: later, store: "late" }),
    ]);
    expect(result?.expiresAt).toEqual(later);
    expect(result?.store).toBe("late");
  });

  it("prefers a dated subscription over one with no expiry at the same tier", () => {
    const dated = new Date(1784807419000);
    const result = pickDesiredSubscription([
      sub({ tier: "premium", expiresAt: null, store: "undated" }),
      sub({ tier: "premium", expiresAt: dated, store: "dated" }),
    ]);
    expect(result?.store).toBe("dated");
  });

  it("resolves to premium_plus over premium when both are active (M19-P0 TIER_RANK precedence)", () => {
    // A customer holding both entitlements (e.g. mid-upgrade sandbox state,
    // or a promotional Premium+ grant stacked on an existing Premium sub)
    // must resolve to the higher-ranked Premium+, not whichever sorts first.
    const result = pickDesiredSubscription([
      sub({ tier: "premium", store: "premium_sub" }),
      sub({ tier: "premium_plus", store: "premium_plus_sub" }),
    ]);
    expect(result?.tier).toBe("premium_plus");
    expect(result?.store).toBe("premium_plus_sub");
  });

  it("resolves to premium_plus regardless of array order (rank wins over position)", () => {
    const result = pickDesiredSubscription([
      sub({ tier: "premium_plus" }),
      sub({ tier: "premium" }),
    ]);
    expect(result?.tier).toBe("premium_plus");
  });

  it("ranks premium_plus below every trainer tier", () => {
    const result = pickDesiredSubscription([
      sub({ tier: "premium_plus" }),
      sub({ tier: "individual_trainer" }),
    ]);
    expect(result?.tier).toBe("individual_trainer");
  });
});
