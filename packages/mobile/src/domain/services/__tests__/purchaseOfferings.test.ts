import type { PurchaseProduct } from "@/domain/ports/purchases.port";
import {
  billingCycleFromProductId,
  billingCycleFromStoreProductId,
  findPackageForTier,
  freeTrialDaysFromGooglePlayOption,
  freeTrialDaysFromIntroOffer,
  offeringTrialDays,
  parseStoreProductId,
  payUpFrontIntroOfferFromGooglePlayOption,
  payUpFrontIntroOfferFromIntroPrice,
  purchasableTiers,
  tierFromProductId,
} from "@/domain/services/purchaseOfferings";

/**
 * The twelve live products, in every identifier shape the mobile purchase
 * layer must classify: Apple dotted (`.monthly`/`.annual`), and the Google
 * Play `subscriptionId:basePlanId` form RevenueCat surfaces on Android. Both
 * must resolve to the same tier + cadence.
 */
const PLAY_IDENTIFIERS: readonly [
  string,
  ReturnType<typeof tierFromProductId>,
  "monthly" | "yearly",
][] = [
  ["app.persistence.premium:monthly", "premium", "monthly"],
  ["app.persistence.premium:annual", "premium", "yearly"],
  ["app.persistence.premium_plus:monthly", "premium_plus", "monthly"],
  ["app.persistence.premium_plus:annual", "premium_plus", "yearly"],
  [
    "app.persistence.trainer.individual:monthly",
    "individual_trainer",
    "monthly",
  ],
  ["app.persistence.trainer.individual:annual", "individual_trainer", "yearly"],
  [
    "app.persistence.start_up_coach_plus:monthly",
    "start_up_coach_plus",
    "monthly",
  ],
  [
    "app.persistence.start_up_coach_plus:annual",
    "start_up_coach_plus",
    "yearly",
  ],
  ["app.persistence.coach:monthly", "coach", "monthly"],
  ["app.persistence.coach:annual", "coach", "yearly"],
  ["app.persistence.coach_pro:monthly", "coach_pro", "monthly"],
  ["app.persistence.coach_pro:annual", "coach_pro", "yearly"],
];

const APPLE_IDENTIFIERS: readonly [
  string,
  ReturnType<typeof tierFromProductId>,
  "monthly" | "yearly",
][] = PLAY_IDENTIFIERS.map(([id, tier, cycle]) => [
  id.replace(":", "."),
  tier,
  cycle,
]);

function pkg(overrides: Partial<PurchaseProduct>): PurchaseProduct {
  return {
    packageId: "$rc_monthly",
    productId: "app.persistence.premium.monthly",
    tier: "premium",
    billingCycle: "monthly",
    price: 9.99,
    priceString: "£9.99",
    pricePerMonthString: "£9.99",
    introTrialDays: null,
    payUpFrontIntroOffer: null,
    ...overrides,
  };
}

describe("billingCycleFromProductId", () => {
  it.each([
    ["app.persistence.premium.monthly", "monthly"],
    ["app.persistence.premium.annual", "yearly"],
    ["app.persistence.premium:annual", "yearly"],
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

describe("parseStoreProductId", () => {
  it("splits a Google Play subscriptionId:basePlanId identifier", () => {
    expect(parseStoreProductId("app.persistence.coach:annual")).toEqual({
      subscriptionId: "app.persistence.coach",
      basePlanId: "annual",
    });
  });

  it("returns a null basePlanId for a bare / Apple-dotted identifier", () => {
    expect(parseStoreProductId("app.persistence.coach")).toEqual({
      subscriptionId: "app.persistence.coach",
      basePlanId: null,
    });
    expect(parseStoreProductId("app.persistence.coach.monthly")).toEqual({
      subscriptionId: "app.persistence.coach.monthly",
      basePlanId: null,
    });
  });

  it("treats a trailing colon with no base plan as null", () => {
    expect(parseStoreProductId("app.persistence.coach:")).toEqual({
      subscriptionId: "app.persistence.coach",
      basePlanId: null,
    });
  });
});

describe("billingCycleFromStoreProductId (strict)", () => {
  it.each(PLAY_IDENTIFIERS)(
    "classifies Play id %s → %s cadence",
    (productId, _tier, expectedCycle) => {
      expect(billingCycleFromStoreProductId(productId)).toBe(expectedCycle);
    },
  );

  it.each(APPLE_IDENTIFIERS)(
    "classifies Apple id %s → %s cadence",
    (productId, _tier, expectedCycle) => {
      expect(billingCycleFromStoreProductId(productId)).toBe(expectedCycle);
    },
  );

  // The hostile cases are the point: an auto-named Play base plan like `p1y`
  // contains neither "annual" nor "year", so the old total classifier would
  // silently render a yearly plan as monthly — the App Store 3.0.0 defect class.
  it.each([
    ["app.persistence.coach_pro:p1y", "yearly"],
    ["app.persistence.coach_pro:p1m", "monthly"],
  ])(
    "recognises the unit-1 ISO-8601 period token in %s → %s",
    (id, expected) => {
      expect(billingCycleFromStoreProductId(id)).toBe(expected);
    },
  );

  // Multi-unit periods have no monthly/yearly representation, so they must DROP
  // (null) rather than mislabel a quarterly/biannual price as "monthly" — the
  // same pricing-misrepresentation class behind the 3.0.0 rejection. No live
  // product uses these; the guard is a latent-trap tripwire.
  it.each([
    ["app.persistence.coach_pro:p3m"],
    ["app.persistence.coach_pro:p6m"],
    ["app.persistence.coach_pro:p2y"],
    ["app.persistence.coach_pro:p12m"],
  ])("drops multi-unit period %s (null, not monthly)", (id) => {
    expect(billingCycleFromStoreProductId(id)).toBeNull();
  });

  it("returns null when the cadence genuinely can't be determined", () => {
    expect(
      billingCycleFromStoreProductId("app.persistence.coach_pro:weird"),
    ).toBeNull();
    expect(
      billingCycleFromStoreProductId("app.persistence.coach_pro"),
    ).toBeNull();
  });

  it("classifies from the base plan id first, falling back to the whole id", () => {
    // basePlanId carries the signal even when the subscription id is neutral.
    expect(billingCycleFromStoreProductId("app.persistence.x:annual")).toBe(
      "yearly",
    );
    // No signal in the base plan → fall back to the full id (Apple-dotted here).
    expect(
      billingCycleFromStoreProductId("app.persistence.premium.annual:base"),
    ).toBe("yearly");
  });
});

describe("freeTrialDaysFromGooglePlayOption", () => {
  it.each([
    ["DAY", 7, 7],
    ["WEEK", 2, 14],
    ["MONTH", 1, 30],
    ["YEAR", 1, 365],
  ])("converts a %s free phase to days", (unit, value, expected) => {
    expect(
      freeTrialDaysFromGooglePlayOption({
        freePhase: {
          billingPeriod: { unit, value },
          price: { amountMicros: 0 },
        },
      }),
    ).toBe(expected);
  });

  it("rejects a zero-length or non-finite free phase", () => {
    expect(
      freeTrialDaysFromGooglePlayOption({
        freePhase: {
          billingPeriod: { unit: "DAY", value: 0 },
          price: { amountMicros: 0 },
        },
      }),
    ).toBeNull();
    expect(
      freeTrialDaysFromGooglePlayOption({
        freePhase: {
          billingPeriod: { unit: "DAY", value: Number.NaN },
          price: { amountMicros: 0 },
        },
      }),
    ).toBeNull();
  });

  it("rejects absent, paid, invalid and unknown phases", () => {
    expect(freeTrialDaysFromGooglePlayOption(null)).toBeNull();
    expect(
      freeTrialDaysFromGooglePlayOption({
        freePhase: {
          billingPeriod: { unit: "DAY", value: 7 },
          price: { amountMicros: 1 },
        },
      }),
    ).toBeNull();
    expect(
      freeTrialDaysFromGooglePlayOption({
        freePhase: {
          billingPeriod: { unit: "UNKNOWN", value: 7 },
          price: { amountMicros: 0 },
        },
      }),
    ).toBeNull();
  });
});

describe("payUpFrontIntroOfferFromGooglePlayOption", () => {
  it("summarises a pay-up-front intro phase", () => {
    expect(
      payUpFrontIntroOfferFromGooglePlayOption({
        introPhase: {
          offerPaymentMode: "SINGLE_PAYMENT",
          billingPeriod: { unit: "MONTH", value: 6 },
          price: { amountMicros: 30_000_000, formatted: "£30.00" },
        },
      }),
    ).toEqual({ priceString: "£30.00", periodLabel: "6 months" });
  });

  it("rejects absent, zero-priced, non-single-payment, or unknown-unit phases", () => {
    expect(payUpFrontIntroOfferFromGooglePlayOption(null)).toBeNull();
    expect(payUpFrontIntroOfferFromGooglePlayOption(undefined)).toBeNull();
    expect(
      payUpFrontIntroOfferFromGooglePlayOption({
        introPhase: {
          offerPaymentMode: "SINGLE_PAYMENT",
          billingPeriod: { unit: "MONTH", value: 6 },
          price: { amountMicros: 0, formatted: "£0.00" },
        },
      }),
    ).toBeNull();
    expect(
      payUpFrontIntroOfferFromGooglePlayOption({
        introPhase: {
          offerPaymentMode: "DISCOUNTED_RECURRING_PAYMENT",
          billingPeriod: { unit: "MONTH", value: 1 },
          price: { amountMicros: 5_000_000, formatted: "£5.00" },
        },
      }),
    ).toBeNull();
    expect(
      payUpFrontIntroOfferFromGooglePlayOption({
        introPhase: {
          offerPaymentMode: "SINGLE_PAYMENT",
          billingPeriod: { unit: "FORTNIGHT", value: 6 },
          price: { amountMicros: 30_000_000, formatted: "£30.00" },
        },
      }),
    ).toBeNull();
  });
});

describe("tierFromProductId", () => {
  it.each([
    ["app.persistence.premium.monthly", "premium"],
    ["app.persistence.trainer.individual.annual", "individual_trainer"],
    ["app.persistence.individual.monthly", "individual_trainer"],
    ["app.persistence.start_up_coach_plus.monthly", "start_up_coach_plus"],
    ["app.persistence.start_up_coach_plus.annual", "start_up_coach_plus"],
    ["app.persistence.coach.monthly", "coach"],
    ["app.persistence.coach.annual", "coach"],
    ["app.persistence.coach_pro.monthly", "coach_pro"],
    ["app.persistence.coach_pro.annual", "coach_pro"],
    ["app.persistence.premium_plus.monthly", "premium_plus"],
    ["app.persistence.premium_plus.annual", "premium_plus"],
  ])("maps %s → %s", (productId, expected) => {
    expect(tierFromProductId(productId)).toBe(expected);
  });

  // The order-sensitive substring ladder must survive Play's `:basePlanId`
  // suffix exactly as it does Apple's dotted cadence — the suffix carries no
  // tier substring, so the same ladder classifies both shapes.
  it.each(PLAY_IDENTIFIERS)(
    "maps Play id %s → %s tier",
    (productId, expectedTier) => {
      expect(tierFromProductId(productId)).toBe(expectedTier);
    },
  );

  it("returns null for an unrecognised id", () => {
    expect(tierFromProductId("app.persistence.gizmo.monthly")).toBeNull();
  });

  // Spec-29 Phase 2 (2026-08-05): every coach product id contains the
  // substring "coach" (`coach_pro`, `start_up_coach_plus`, `coach` itself),
  // so the ORDER of the substring checks is load-bearing — `coach_pro` and
  // `start_up_coach_plus` MUST be tested before the plain `coach` match, or
  // every Coach Pro / Start Up Coach + purchase would misclassify as the
  // cheaper `coach` tier and under-grant the entitlement.
  it("classifies coach_pro and start_up_coach_plus BEFORE the plain coach substring match", () => {
    expect(tierFromProductId("app.persistence.coach_pro.monthly")).toBe(
      "coach_pro",
    );
    expect(tierFromProductId("app.persistence.coach_pro.annual")).toBe(
      "coach_pro",
    );
    expect(
      tierFromProductId("app.persistence.start_up_coach_plus.monthly"),
    ).toBe("start_up_coach_plus");
    expect(
      tierFromProductId("app.persistence.start_up_coach_plus.annual"),
    ).toBe("start_up_coach_plus");
    // Plain coach is unaffected by the reordering.
    expect(tierFromProductId("app.persistence.coach.monthly")).toBe("coach");
  });

  it("classifies premium_plus BEFORE the plain premium substring match (M19-P0 regression)", () => {
    // `app.persistence.premium_plus.monthly` also contains the substring
    // "premium" — if that branch were checked first, every Premium+
    // purchase would misclassify as Premium and grant the wrong
    // entitlement. Both cycles covered since the real product ids ship
    // as separate monthly/annual SKUs.
    expect(tierFromProductId("app.persistence.premium_plus.monthly")).toBe(
      "premium_plus",
    );
    expect(tierFromProductId("app.persistence.premium_plus.annual")).toBe(
      "premium_plus",
    );
    // Plain premium is unaffected by the reordering.
    expect(tierFromProductId("app.persistence.premium.annual")).toBe("premium");
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
    expect(findPackageForTier(packages, "coach", "monthly")).toBeNull();
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

describe("payUpFrontIntroOfferFromIntroPrice", () => {
  it("summarises a one-off pay-up-front offer", () => {
    expect(
      payUpFrontIntroOfferFromIntroPrice({
        price: 30,
        priceString: "£30.00",
        cycles: 1,
        periodUnit: "MONTH",
        periodNumberOfUnits: 6,
      }),
    ).toEqual({ priceString: "£30.00", periodLabel: "6 months" });
    expect(
      payUpFrontIntroOfferFromIntroPrice({
        price: 60,
        priceString: "£60.00",
        cycles: 1,
        periodUnit: "YEAR",
        periodNumberOfUnits: 1,
      }),
    ).toEqual({ priceString: "£60.00", periodLabel: "1 year" });
  });

  it("returns null for a free trial (price 0)", () => {
    expect(
      payUpFrontIntroOfferFromIntroPrice({
        price: 0,
        priceString: "£0.00",
        cycles: 1,
        periodUnit: "DAY",
        periodNumberOfUnits: 14,
      }),
    ).toBeNull();
  });

  it("returns null for a discounted-recurring 'pay as you go' offer (cycles > 1)", () => {
    expect(
      payUpFrontIntroOfferFromIntroPrice({
        price: 4.99,
        priceString: "£4.99",
        cycles: 3,
        periodUnit: "MONTH",
        periodNumberOfUnits: 1,
      }),
    ).toBeNull();
  });

  it("returns null for absent, zero-length, or unknown-unit offers", () => {
    expect(payUpFrontIntroOfferFromIntroPrice(null)).toBeNull();
    expect(payUpFrontIntroOfferFromIntroPrice(undefined)).toBeNull();
    expect(
      payUpFrontIntroOfferFromIntroPrice({
        price: 30,
        priceString: "£30.00",
        cycles: 1,
        periodUnit: "MONTH",
        periodNumberOfUnits: 0,
      }),
    ).toBeNull();
    expect(
      payUpFrontIntroOfferFromIntroPrice({
        price: 30,
        priceString: "£30.00",
        cycles: 1,
        periodUnit: "FORTNIGHT",
        periodNumberOfUnits: 6,
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
