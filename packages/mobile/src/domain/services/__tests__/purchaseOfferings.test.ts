import type { PurchaseProduct } from "@/domain/ports/purchases.port";
import {
  billingCycleFromProductId,
  findPackageForTier,
  freeTrialDaysFromIntroOffer,
  offeringTrialDays,
  purchasableTiers,
  tierFromProductId,
} from "@/domain/services/purchaseOfferings";

function pkg(overrides: Partial<PurchaseProduct>): PurchaseProduct {
  return {
    packageId: "$rc_monthly",
    productId: "app.persistence.premium.monthly",
    tier: "premium",
    billingCycle: "monthly",
    priceString: "£9.99",
    introTrialDays: null,
    ...overrides,
  };
}

describe("billingCycleFromProductId", () => {
  it.each([
    ["app.persistence.premium.monthly", "monthly"],
    ["app.persistence.premium.annual", "yearly"],
    ["app.persistence.trainer.individual.yearly", "yearly"],
    ["something.year.plan", "yearly"],
    ["no.cycle.signal", "monthly"],
  ])("maps %s → %s", (productId, expected) => {
    expect(billingCycleFromProductId(productId)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(billingCycleFromProductId("APP.PREMIUM.ANNUAL")).toBe("yearly");
  });
});

describe("tierFromProductId", () => {
  it.each([
    ["app.persistence.premium.monthly", "premium"],
    ["app.persistence.trainer.individual.annual", "individual_trainer"],
    ["app.persistence.individual.monthly", "individual_trainer"],
    ["app.persistence.small_business.monthly", "small_business"],
    ["app.persistence.trainer.small_business.annual", "small_business"],
    ["app.persistence.medium_enterprise.annual", "medium_enterprise"],
    ["app.persistence.enterprise.monthly", "medium_enterprise"],
  ])("maps %s → %s", (productId, expected) => {
    expect(tierFromProductId(productId)).toBe(expected);
  });

  it("returns null for an unrecognised id", () => {
    expect(tierFromProductId("app.persistence.gizmo.monthly")).toBeNull();
  });

  it("prefers the most specific business keyword over the trainer match", () => {
    // contains both "trainer" and "small_business" — business wins.
    expect(tierFromProductId("app.persistence.trainer.small_business")).toBe(
      "small_business",
    );
  });
});

describe("findPackageForTier", () => {
  const packages: PurchaseProduct[] = [
    pkg({ tier: "premium", billingCycle: "monthly", packageId: "p_m" }),
    pkg({ tier: "premium", billingCycle: "yearly", packageId: "p_y" }),
    pkg({
      tier: "individual_trainer",
      billingCycle: "monthly",
      packageId: "t_m",
    }),
  ];

  it("finds the matching tier + cycle", () => {
    expect(findPackageForTier(packages, "premium", "yearly")?.packageId).toBe(
      "p_y",
    );
    expect(
      findPackageForTier(packages, "individual_trainer", "monthly")?.packageId,
    ).toBe("t_m");
  });

  it("returns null when no package matches the cycle", () => {
    expect(
      findPackageForTier(packages, "individual_trainer", "yearly"),
    ).toBeNull();
  });

  it("returns null when the tier is absent", () => {
    expect(
      findPackageForTier(packages, "small_business", "monthly"),
    ).toBeNull();
  });
});

describe("purchasableTiers", () => {
  it("collects the distinct mapped tiers, skipping null", () => {
    const tiers = purchasableTiers([
      pkg({ tier: "premium" }),
      pkg({ tier: "premium", billingCycle: "yearly" }),
      pkg({ tier: "individual_trainer" }),
      pkg({ tier: null, productId: "unknown" }),
    ]);
    expect([...tiers].sort()).toEqual(["individual_trainer", "premium"]);
  });

  it("is empty for no packages", () => {
    expect(purchasableTiers([]).size).toBe(0);
  });
});

describe("freeTrialDaysFromIntroOffer", () => {
  it("converts a free-trial period to days by unit", () => {
    expect(
      freeTrialDaysFromIntroOffer({
        price: 0,
        periodUnit: "DAY",
        periodNumberOfUnits: 14,
      }),
    ).toBe(14);
    expect(
      freeTrialDaysFromIntroOffer({
        price: 0,
        periodUnit: "WEEK",
        periodNumberOfUnits: 2,
      }),
    ).toBe(14);
    expect(
      freeTrialDaysFromIntroOffer({
        price: 0,
        periodUnit: "MONTH",
        periodNumberOfUnits: 1,
      }),
    ).toBe(30);
    expect(
      freeTrialDaysFromIntroOffer({
        price: 0,
        periodUnit: "YEAR",
        periodNumberOfUnits: 1,
      }),
    ).toBe(365);
  });

  it("returns null for a paid intro offer (not a free trial)", () => {
    expect(
      freeTrialDaysFromIntroOffer({
        price: 4.99,
        periodUnit: "MONTH",
        periodNumberOfUnits: 1,
      }),
    ).toBeNull();
  });

  it("returns null for absent, zero-length, or unknown-unit offers", () => {
    expect(freeTrialDaysFromIntroOffer(null)).toBeNull();
    expect(freeTrialDaysFromIntroOffer(undefined)).toBeNull();
    expect(
      freeTrialDaysFromIntroOffer({
        price: 0,
        periodUnit: "DAY",
        periodNumberOfUnits: 0,
      }),
    ).toBeNull();
    expect(
      freeTrialDaysFromIntroOffer({
        price: 0,
        periodUnit: "FORTNIGHT",
        periodNumberOfUnits: 1,
      }),
    ).toBeNull();
  });
});

describe("offeringTrialDays", () => {
  it("returns the first package's free-trial length when present", () => {
    const packages = [
      pkg({ tier: "premium", introTrialDays: null }),
      pkg({ tier: "individual_trainer", introTrialDays: 14 }),
    ];
    expect(offeringTrialDays(packages)).toBe(14);
  });

  it("returns null when no package carries a real free-trial offer (never guesses a duration)", () => {
    expect(offeringTrialDays([pkg({ introTrialDays: null })])).toBeNull();
    expect(offeringTrialDays([])).toBeNull();
  });
});
