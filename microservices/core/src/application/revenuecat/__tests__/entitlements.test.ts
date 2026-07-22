import { describe, expect, it } from "vitest";
import {
  billingCycleFromPeriodMs,
  pickDesiredSubscription,
  rcEntitlementToTier,
  type NormalizedSubscription,
} from "../entitlements";

describe("rcEntitlementToTier", () => {
  it("maps the four known entitlement ids to their tiers", () => {
    expect(rcEntitlementToTier("premium")).toBe("premium");
    expect(rcEntitlementToTier("individual_trainer")).toBe(
      "individual_trainer",
    );
    expect(rcEntitlementToTier("small_business")).toBe("small_business");
    expect(rcEntitlementToTier("medium_enterprise")).toBe("medium_enterprise");
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
      sub({ tier: "medium_enterprise" }),
      sub({ tier: "individual_trainer" }),
    ]);
    expect(result?.tier).toBe("medium_enterprise");
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
});
