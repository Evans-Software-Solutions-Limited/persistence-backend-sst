import { describe, expect, it } from "vitest";
import {
  billingCycleFromProductId,
  pickDesiredSubscription,
  rcEntitlementToTier,
  type NormalizedEntitlement,
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

describe("billingCycleFromProductId", () => {
  it("defaults to monthly for null or a monthly product id", () => {
    expect(billingCycleFromProductId(null)).toBe("monthly");
    expect(billingCycleFromProductId("premium_monthly")).toBe("monthly");
  });

  it("detects yearly from 'annual' or 'year'", () => {
    expect(billingCycleFromProductId("premium_annual")).toBe("yearly");
    expect(billingCycleFromProductId("trainer_yearly")).toBe("yearly");
    expect(billingCycleFromProductId("PREMIUM_ANNUAL")).toBe("yearly");
  });
});

describe("pickDesiredSubscription", () => {
  const ent = (
    over: Partial<NormalizedEntitlement> = {},
  ): NormalizedEntitlement => ({
    tier: "premium",
    expiresAt: null,
    productId: null,
    store: null,
    ...over,
  });

  it("returns null when there are no active entitlements", () => {
    expect(pickDesiredSubscription([])).toBeNull();
  });

  it("returns the single entitlement's derived state", () => {
    const expiresAt = new Date("2026-07-01T00:00:00.000Z");
    const result = pickDesiredSubscription([
      ent({
        tier: "premium",
        expiresAt,
        productId: "premium_annual",
        store: "app_store",
      }),
    ]);
    expect(result).toEqual({
      tier: "premium",
      expiresAt,
      billingCycle: "yearly",
      productId: "premium_annual",
      store: "app_store",
    });
  });

  it("picks the highest-ranked tier when multiple are active", () => {
    const result = pickDesiredSubscription([
      ent({ tier: "premium" }),
      ent({ tier: "medium_enterprise", productId: "biz_monthly" }),
      ent({ tier: "individual_trainer" }),
    ]);
    expect(result?.tier).toBe("medium_enterprise");
  });
});
