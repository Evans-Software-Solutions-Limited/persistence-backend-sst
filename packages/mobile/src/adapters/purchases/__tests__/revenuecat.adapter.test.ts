import { Platform } from "react-native";
import Purchases, { STORE_REPLACEMENT_MODE } from "react-native-purchases";
import {
  classifyPurchasesError,
  RevenueCatPurchasesAdapter,
} from "@/adapters/purchases/revenuecat.adapter";

// `Purchases` is the global jest mock (see __tests__/setup.ts); cast to the
// mocked shape so we can drive each static method per-test.
const mockPurchases = Purchases as unknown as {
  configure: jest.Mock;
  setLogLevel: jest.Mock;
  logIn: jest.Mock;
  logOut: jest.Mock;
  getOfferings: jest.Mock;
  getCustomerInfo: jest.Mock;
  purchasePackage: jest.Mock;
  restorePurchases: jest.Mock;
  checkTrialOrIntroductoryPriceEligibility: jest.Mock;
};

function offeringWith(packages: unknown[]) {
  return {
    all: { default: { identifier: "default", availablePackages: packages } },
    current: null,
  };
}

const PREMIUM_PKG = {
  identifier: "$rc_monthly",
  packageType: "MONTHLY",
  product: {
    identifier: "app.persistence.premium.monthly",
    price: 9.99,
    priceString: "£9.99",
    pricePerMonthString: "£9.99",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPurchases.getCustomerInfo.mockResolvedValue({
    activeSubscriptions: [],
    managementURL: null,
  });
});

describe("RevenueCatPurchasesAdapter — configure", () => {
  it("configures once with a non-empty key", () => {
    const a = new RevenueCatPurchasesAdapter();
    expect(a.isConfigured()).toBe(false);
    a.configure("appl_public_key");
    a.configure("appl_public_key"); // idempotent
    expect(a.isConfigured()).toBe(true);
    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.configure).toHaveBeenCalledWith({
      apiKey: "appl_public_key",
    });
  });

  it("is a no-op for an empty key", () => {
    const a = new RevenueCatPurchasesAdapter();
    a.configure("");
    expect(a.isConfigured()).toBe(false);
    expect(mockPurchases.configure).not.toHaveBeenCalled();
  });
});

describe("RevenueCatPurchasesAdapter — guards when unconfigured", () => {
  it("native operations fail not_configured", async () => {
    const a = new RevenueCatPurchasesAdapter();
    const login = await a.logIn("u-1");
    const pkgs = await a.getPurchasablePackages();
    const elig = await a.getIntroEligibility(["x"]);
    const management = await a.getManagementUrl();
    const buy = await a.purchase("$rc_monthly");
    const restore = await a.restore();
    for (const r of [login, pkgs, elig, management, buy, restore]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("not_configured");
    }
  });

  it("logOut is a no-op success when unconfigured", async () => {
    const a = new RevenueCatPurchasesAdapter();
    const r = await a.logOut();
    expect(r.ok).toBe(true);
    expect(mockPurchases.logOut).not.toHaveBeenCalled();
  });
});

describe("RevenueCatPurchasesAdapter — configured flows", () => {
  function configured(): RevenueCatPurchasesAdapter {
    const a = new RevenueCatPurchasesAdapter();
    a.configure("appl_public_key");
    return a;
  }

  async function configuredAndBound(): Promise<RevenueCatPurchasesAdapter> {
    const a = configured();
    mockPurchases.logIn.mockResolvedValue({ created: false });
    await a.logIn("supabase-uid");
    return a;
  }

  it("returns RevenueCat's originating-store management URL", async () => {
    const a = await configuredAndBound();
    mockPurchases.getCustomerInfo.mockResolvedValue({
      activeSubscriptions: ["app.persistence.premium"],
      managementURL: "https://play.google.com/store/account/subscriptions",
    });
    const result = await a.getManagementUrl();
    expect(result).toEqual({
      ok: true,
      value: "https://play.google.com/store/account/subscriptions",
    });
  });

  it("logIn binds the supabase id", async () => {
    const a = configured();
    mockPurchases.logIn.mockResolvedValue({ created: false });
    const r = await a.logIn("supabase-uid");
    expect(r.ok).toBe(true);
    expect(mockPurchases.logIn).toHaveBeenCalledWith("supabase-uid");
  });

  it("getPurchasablePackages normalises the default offering", async () => {
    const a = configured();
    mockPurchases.getOfferings.mockResolvedValue(offeringWith([PREMIUM_PKG]));
    const r = await a.getPurchasablePackages();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([
        {
          packageId: "$rc_monthly",
          productId: "app.persistence.premium.monthly",
          tier: "premium",
          billingCycle: "monthly",
          price: 9.99,
          priceString: "£9.99",
          pricePerMonthString: "£9.99",
          // No introPrice on the fixture → no free-trial length.
          introTrialDays: null,
        },
      ]);
    }
  });

  it("derives introTrialDays from a free-trial introductory offer", async () => {
    const a = configured();
    mockPurchases.getOfferings.mockResolvedValue(
      offeringWith([
        {
          identifier: "$rc_monthly",
          packageType: "MONTHLY",
          product: {
            identifier: "app.persistence.premium.monthly",
            price: 9.99,
            priceString: "£9.99",
            introPrice: {
              price: 0,
              periodUnit: "DAY",
              periodNumberOfUnits: 14,
            },
          },
        },
      ]),
    );
    const r = await a.getPurchasablePackages();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0].introTrialDays).toBe(14);
  });

  it("normalises a Google Play base plan and its selected free-trial phase", async () => {
    const a = configured();
    mockPurchases.getOfferings.mockResolvedValue(
      offeringWith([
        {
          identifier: "premium-monthly",
          packageType: "CUSTOM",
          product: {
            identifier: "app.persistence.premium",
            price: 9.99,
            priceString: "£9.99",
            pricePerMonthString: "£9.99",
            defaultOption: {
              storeProductId: "app.persistence.premium:monthly",
              freePhase: {
                billingPeriod: { unit: "WEEK", value: 2 },
                price: { amountMicros: 0 },
              },
            },
          },
        },
      ]),
    );
    const r = await a.getPurchasablePackages();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]).toMatchObject({
        packageId: "premium-monthly",
        productId: "app.persistence.premium:monthly",
        tier: "premium",
        billingCycle: "monthly",
        introTrialDays: 14,
      });
    }
  });

  it("maps intro eligibility: only ELIGIBLE → true", async () => {
    const a = configured();
    mockPurchases.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      "app.persistence.premium.monthly": { status: 2 }, // ELIGIBLE
      "app.persistence.trainer.individual.monthly": { status: 1 }, // INELIGIBLE
      "app.persistence.small_business.monthly": { status: 0 }, // UNKNOWN
      "app.persistence.medium_enterprise.monthly": { status: 3 }, // NO_INTRO
    });
    const r = await a.getIntroEligibility([
      "app.persistence.premium.monthly",
      "app.persistence.trainer.individual.monthly",
      "app.persistence.small_business.monthly",
      "app.persistence.medium_enterprise.monthly",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        "app.persistence.premium.monthly": true,
        "app.persistence.trainer.individual.monthly": false,
        "app.persistence.small_business.monthly": false,
        "app.persistence.medium_enterprise.monthly": false,
      });
    }
  });

  it("getIntroEligibility fails cleanly on a thrown SDK error", async () => {
    const a = configured();
    mockPurchases.checkTrialOrIntroductoryPriceEligibility.mockRejectedValue(
      new Error("store down"),
    );
    const r = await a.getIntroEligibility(["x"]);
    expect(r.ok).toBe(false);
  });

  it("getPurchasablePackages returns empty when no offering exists", async () => {
    const a = configured();
    mockPurchases.getOfferings.mockResolvedValue({ all: {}, current: null });
    const r = await a.getPurchasablePackages();
    expect(r.ok && r.value).toEqual([]);
  });

  it("purchase resolves active entitlements on success", async () => {
    const a = await configuredAndBound();
    mockPurchases.getOfferings.mockResolvedValue(offeringWith([PREMIUM_PKG]));
    mockPurchases.purchasePackage.mockResolvedValue({
      customerInfo: {
        entitlements: {
          active: {
            premium: {
              identifier: "premium",
              productIdentifier: "app.persistence.premium.monthly",
              expirationDate: "2026-12-01T00:00:00Z",
            },
          },
        },
      },
    });
    const r = await a.purchase("$rc_monthly");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([
        {
          entitlementId: "premium",
          tier: "premium",
          productId: "app.persistence.premium.monthly",
          expiresAt: "2026-12-01T00:00:00Z",
        },
      ]);
    }
    expect(mockPurchases.purchasePackage).toHaveBeenCalledWith(PREMIUM_PKG);
  });

  it("blocks a purchase until RevenueCat confirms the Supabase identity", async () => {
    const a = configured();
    const result = await a.purchase("$rc_monthly");
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "identity_not_bound" }),
    });
    expect(mockPurchases.getOfferings).not.toHaveBeenCalled();
    expect(mockPurchases.purchasePackage).not.toHaveBeenCalled();
  });

  it("passes the active Play product when replacing an Android subscription", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "android";
    try {
      const a = await configuredAndBound();
      mockPurchases.getOfferings.mockResolvedValue(offeringWith([PREMIUM_PKG]));
      mockPurchases.getCustomerInfo.mockResolvedValue({
        activeSubscriptions: ["app.persistence.premium"],
      });
      mockPurchases.purchasePackage.mockResolvedValue({
        customerInfo: { entitlements: { active: {} } },
      });
      await a.purchase("$rc_monthly");
      expect(mockPurchases.purchasePackage).toHaveBeenCalledWith(
        PREMIUM_PKG,
        null,
        {
          oldProductIdentifier: "app.persistence.premium",
          replacementMode: STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION,
        },
      );
    } finally {
      Platform.OS = originalOS;
    }
  });

  it("does not pass an Apple product into Play subscription replacement", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "android";
    try {
      const a = await configuredAndBound();
      mockPurchases.getOfferings.mockResolvedValue(offeringWith([PREMIUM_PKG]));
      mockPurchases.getCustomerInfo.mockResolvedValue({
        activeSubscriptions: ["app.persistence.premium.monthly"],
        managementURL: "https://apps.apple.com/account/subscriptions",
      });
      mockPurchases.purchasePackage.mockResolvedValue({
        customerInfo: { entitlements: { active: {} } },
      });
      await a.purchase("$rc_monthly");
      expect(mockPurchases.purchasePackage).toHaveBeenCalledWith(
        PREMIUM_PKG,
        null,
        null,
      );
    } finally {
      Platform.OS = originalOS;
    }
  });

  it("purchase fails store_problem when the package id is gone", async () => {
    const a = await configuredAndBound();
    mockPurchases.getOfferings.mockResolvedValue(offeringWith([PREMIUM_PKG]));
    const r = await a.purchase("$rc_unknown");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("store_problem");
  });

  it("purchase maps a user cancellation to kind cancelled", async () => {
    const a = await configuredAndBound();
    mockPurchases.getOfferings.mockResolvedValue(offeringWith([PREMIUM_PKG]));
    mockPurchases.purchasePackage.mockRejectedValue({
      userCancelled: true,
      code: "1",
    });
    const r = await a.purchase("$rc_monthly");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("cancelled");
  });

  it("restore resolves active entitlements", async () => {
    const a = await configuredAndBound();
    mockPurchases.restorePurchases.mockResolvedValue({
      entitlements: { active: {} },
    });
    const r = await a.restore();
    expect(r.ok && r.value).toEqual([]);
  });

  it("blocks restore until RevenueCat confirms the Supabase identity", async () => {
    const a = configured();
    const result = await a.restore();
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "identity_not_bound" }),
    });
    expect(mockPurchases.restorePurchases).not.toHaveBeenCalled();
  });
});

describe("classifyPurchasesError", () => {
  it("flags user cancellation", () => {
    expect(classifyPurchasesError({ userCancelled: true }).kind).toBe(
      "cancelled",
    );
  });
  it("maps a network message", () => {
    expect(
      classifyPurchasesError({ message: "Network error occurred" }).kind,
    ).toBe("network");
  });
  it("maps a not-allowed message", () => {
    expect(
      classifyPurchasesError({ message: "Purchases are not allowed" }).kind,
    ).toBe("purchase_not_allowed");
  });
  it("maps a deferred (Ask to Buy) purchase to pending, ahead of the payment→store match", () => {
    expect(
      classifyPurchasesError({
        code: "PAYMENT_PENDING_ERROR",
        message: "The payment is pending.",
      }).kind,
    ).toBe("pending");
  });
  it("maps a store/payment message", () => {
    expect(classifyPurchasesError({ message: "payment declined" }).kind).toBe(
      "store_problem",
    );
  });
  it("falls back to unknown for an unrecognised message", () => {
    expect(classifyPurchasesError({ message: "weird" }).kind).toBe("unknown");
  });

  it("treats a bare/null throw as a generic store problem", () => {
    // The default message mentions "purchase", so a null/empty throw maps to
    // store_problem rather than unknown — a sensible default for the UI.
    const r = classifyPurchasesError(null);
    expect(r.kind).toBe("store_problem");
    expect(r.code).toBeNull();
  });
});
