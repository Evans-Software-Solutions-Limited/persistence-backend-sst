import { catalogTier } from "@persistence/subscription-catalog";
import {
  BLC_OFFER,
  BLC_TIERS,
  blcPlanContentId,
  blcTierFeatures,
  blcTierName,
  formatBlcPrice,
  isBlcCadence,
  isBlcTier,
} from "../blcOffer";

describe("BLC_OFFER", () => {
  it("is 20% off the public price on every tier and cadence, to the penny agreed", () => {
    expect(BLC_OFFER.premium.monthly).toEqual({
      publicMinor: 1699,
      memberMinor: 1359,
    });
    expect(BLC_OFFER.premium.annual).toEqual({
      publicMinor: 13999,
      memberMinor: 11199,
    });
    expect(BLC_OFFER.premium_plus.monthly).toEqual({
      publicMinor: 2999,
      memberMinor: 2399,
    });
    expect(BLC_OFFER.premium_plus.annual).toEqual({
      publicMinor: 24999,
      memberMinor: 19999,
    });
    for (const tier of BLC_TIERS) {
      for (const cadence of ["monthly", "annual"] as const) {
        const { publicMinor, memberMinor } = BLC_OFFER[tier][cadence];
        // Within a penny of exactly 20% off — the agreed figures are rounded.
        expect(Math.abs(memberMinor - publicMinor * 0.8)).toBeLessThan(1);
      }
    }
  });

  it("names and features come from the shared catalog", () => {
    expect(blcTierName("premium")).toBe(catalogTier("premium").name);
    expect(blcTierFeatures("premium_plus")).toBe(
      catalogTier("premium_plus").features,
    );
  });
});

describe("blcPlanContentId", () => {
  it("builds one canonical id per tier x cadence", () => {
    expect(blcPlanContentId("premium", "monthly")).toBe("blc_premium_monthly");
    expect(blcPlanContentId("premium", "annual")).toBe("blc_premium_annual");
    expect(blcPlanContentId("premium_plus", "monthly")).toBe(
      "blc_premium_plus_monthly",
    );
    expect(blcPlanContentId("premium_plus", "annual")).toBe(
      "blc_premium_plus_annual",
    );
  });

  it("returns undefined rather than guessing for anything else", () => {
    expect(blcPlanContentId("coach", "annual")).toBeUndefined();
    expect(blcPlanContentId("premium", "weekly")).toBeUndefined();
    expect(blcPlanContentId(undefined, undefined)).toBeUndefined();
  });

  it("guards are exact", () => {
    expect(isBlcTier("premium")).toBe(true);
    expect(isBlcTier("free")).toBe(false);
    expect(isBlcCadence("annual")).toBe(true);
    expect(isBlcCadence(12)).toBe(false);
  });
});

describe("formatBlcPrice", () => {
  it("always shows pence, as the agreed prices all carry them", () => {
    expect(formatBlcPrice(1359)).toBe("£13.59");
    expect(formatBlcPrice(11199)).toBe("£111.99");
  });
});
