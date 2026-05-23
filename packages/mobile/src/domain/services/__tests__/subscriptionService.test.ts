import type {
  MySubscription,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import {
  canCancelSubscription,
  getSubscriptionDisplayInfo,
  isCancelledButActive,
  isFreeTier,
  isSubscriptionActive,
  isTrialing,
  shouldShowTrialBanner,
} from "@/domain/services/subscriptionService";

/**
 * Unit tests for the M10 subscription domain services. Ported behaviour-
 * for-behaviour from legacy `persistence-mobile/lib/utils/subscriptionUtils.ts`
 * — each predicate's edge cases are exercised explicitly so a future
 * spec change has to update a failing test, not happen silently.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Test strategy
 */

const FUTURE_ISO = "2030-01-01T00:00:00.000Z";
const PAST_ISO = "2020-01-01T00:00:00.000Z";

function makeSub(
  overrides: Partial<MySubscription> = {},
): MySubscription {
  return {
    subscriptionId: "us_1",
    tierName: "premium",
    paymentStatus: "active",
    billingCycle: "monthly",
    startsAt: "2026-01-01T00:00:00.000Z",
    expiresAt: FUTURE_ISO,
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: "sub_test_1",
    tierDisplayName: "Premium",
    tierDescription: null,
    workoutLimit: null,
    aiAccess: true,
    aiWorkoutLimit: 6,
    gymBuddyAccess: true,
    trainerClientLimit: null,
    isTrainerTier: false,
    role: "user",
    hasUsedUserTrial: false,
    hasUsedTrainerTrial: false,
    isEligibleForUserTrial: true,
    isEligibleForTrainerTrial: true,
    scheduledChange: null,
    ...overrides,
  };
}

describe("isFreeTier", () => {
  it("returns true when subscription is null", () => {
    expect(isFreeTier(null)).toBe(true);
  });

  it("returns true when subscription is undefined", () => {
    expect(isFreeTier(undefined)).toBe(true);
  });

  it("returns true when tier_name is 'free'", () => {
    expect(isFreeTier(makeSub({ tierName: "free" }))).toBe(true);
  });

  it("returns false for paid tiers (basic, premium)", () => {
    expect(isFreeTier(makeSub({ tierName: "basic" }))).toBe(false);
    expect(isFreeTier(makeSub({ tierName: "premium" }))).toBe(false);
  });

  it("returns false for trainer tiers", () => {
    expect(
      isFreeTier(makeSub({ tierName: "individual_trainer_pro" })),
    ).toBe(false);
  });

  it("returns false for trialing subscriptions on paid tiers (legacy parity)", () => {
    expect(
      isFreeTier(
        makeSub({ tierName: "premium", paymentStatus: "trialing" }),
      ),
    ).toBe(false);
  });
});

describe("isSubscriptionActive", () => {
  it("returns false when subscription is null", () => {
    expect(isSubscriptionActive(null)).toBe(false);
  });

  it("returns false when cancelledAt is set", () => {
    expect(
      isSubscriptionActive(makeSub({ cancelledAt: "2026-01-01T00:00:00.000Z" })),
    ).toBe(false);
  });

  it("returns false when expiresAt is null (synthetic free shape)", () => {
    expect(isSubscriptionActive(makeSub({ expiresAt: null }))).toBe(false);
  });

  it("returns false when expiresAt is in the past", () => {
    expect(isSubscriptionActive(makeSub({ expiresAt: PAST_ISO }))).toBe(false);
  });

  it("returns true when not cancelled and expiresAt is in the future", () => {
    expect(isSubscriptionActive(makeSub())).toBe(true);
  });
});

describe("canCancelSubscription", () => {
  it("returns false for null subscription", () => {
    expect(canCancelSubscription(null)).toBe(false);
  });

  it("returns false for free tier", () => {
    expect(canCancelSubscription(makeSub({ tierName: "free" }))).toBe(false);
  });

  it("returns false when already cancelled", () => {
    expect(
      canCancelSubscription(
        makeSub({ cancelledAt: "2026-01-01T00:00:00.000Z" }),
      ),
    ).toBe(false);
  });

  it("returns false when expired", () => {
    expect(canCancelSubscription(makeSub({ expiresAt: PAST_ISO }))).toBe(false);
  });

  it("returns true for an active paid subscription", () => {
    expect(canCancelSubscription(makeSub())).toBe(true);
  });

  it("returns true for a trialing subscription (legacy parity — trials cancelable)", () => {
    expect(
      canCancelSubscription(makeSub({ paymentStatus: "trialing" })),
    ).toBe(true);
  });
});

describe("isTrialing", () => {
  it("returns false for null", () => {
    expect(isTrialing(null)).toBe(false);
  });

  it("returns true when paymentStatus is 'trialing'", () => {
    expect(isTrialing(makeSub({ paymentStatus: "trialing" }))).toBe(true);
  });

  it("returns false for other payment statuses", () => {
    expect(isTrialing(makeSub({ paymentStatus: "active" }))).toBe(false);
    expect(isTrialing(makeSub({ paymentStatus: "past_due" }))).toBe(false);
    expect(isTrialing(makeSub({ paymentStatus: "cancelled" }))).toBe(false);
  });
});

describe("isCancelledButActive", () => {
  it("returns false for null", () => {
    expect(isCancelledButActive(null)).toBe(false);
  });

  it("returns false when cancelledAt is null", () => {
    expect(isCancelledButActive(makeSub({ cancelledAt: null }))).toBe(false);
  });

  it("returns false when expiresAt is null", () => {
    expect(
      isCancelledButActive(
        makeSub({
          cancelledAt: "2026-01-01T00:00:00.000Z",
          expiresAt: null,
        }),
      ),
    ).toBe(false);
  });

  it("returns false when expiresAt is in the past", () => {
    expect(
      isCancelledButActive(
        makeSub({
          cancelledAt: "2026-01-01T00:00:00.000Z",
          expiresAt: PAST_ISO,
        }),
      ),
    ).toBe(false);
  });

  it("returns true when cancelled and expiresAt is in the future", () => {
    expect(
      isCancelledButActive(
        makeSub({
          cancelledAt: "2026-01-01T00:00:00.000Z",
          expiresAt: FUTURE_ISO,
        }),
      ),
    ).toBe(true);
  });
});

describe("shouldShowTrialBanner", () => {
  const eligible = {
    isEligibleForUserTrial: true,
    isEligibleForTrainerTrial: true,
  };
  const ineligible = {
    isEligibleForUserTrial: false,
    isEligibleForTrainerTrial: false,
  };

  it("returns false when eligibility is null (data not loaded)", () => {
    expect(shouldShowTrialBanner(null, "premium")).toBe(false);
    expect(shouldShowTrialBanner(undefined, "premium")).toBe(false);
  });

  it("uses user-trial flag for 'premium'", () => {
    expect(shouldShowTrialBanner(eligible, "premium")).toBe(true);
    expect(shouldShowTrialBanner(ineligible, "premium")).toBe(false);
    expect(
      shouldShowTrialBanner(
        { isEligibleForUserTrial: true, isEligibleForTrainerTrial: false },
        "premium",
      ),
    ).toBe(true);
  });

  it("uses trainer-trial flag for any '_pro' tier", () => {
    const proTiers: SubscriptionTierName[] = [
      "individual_trainer_pro",
      "small_business_pro",
      "medium_enterprise_pro",
    ];
    for (const tier of proTiers) {
      expect(shouldShowTrialBanner(eligible, tier)).toBe(true);
      expect(shouldShowTrialBanner(ineligible, tier)).toBe(false);
    }
  });

  it("returns false for tiers with no trial offering", () => {
    expect(shouldShowTrialBanner(eligible, "free")).toBe(false);
    expect(shouldShowTrialBanner(eligible, "basic")).toBe(false);
    expect(
      shouldShowTrialBanner(eligible, "individual_trainer_standard"),
    ).toBe(false);
    expect(shouldShowTrialBanner(eligible, "small_business_standard")).toBe(
      false,
    );
    expect(
      shouldShowTrialBanner(eligible, "medium_enterprise_standard"),
    ).toBe(false);
  });
});

describe("getSubscriptionDisplayInfo", () => {
  const tierNames: Record<string, string> = {
    free: "Free",
    basic: "Basic",
    premium: "Premium",
    individual_trainer_standard: "Individual Trainer (Standard)",
    individual_trainer_pro: "Individual Trainer (Pro)",
  };

  it("returns Free-defaults for null subscription", () => {
    expect(getSubscriptionDisplayInfo(null, tierNames)).toEqual({
      currentTierDisplayName: "Free",
      hasScheduledChange: false,
      nextTierDisplayName: null,
      effectiveAt: null,
      currentTierActiveUntil: null,
    });
  });

  it("maps tier_name to display_name via the catalog dictionary", () => {
    const info = getSubscriptionDisplayInfo(
      makeSub({ tierName: "premium" }),
      tierNames,
    );
    expect(info.currentTierDisplayName).toBe("Premium");
    expect(info.hasScheduledChange).toBe(false);
    expect(info.currentTierActiveUntil).toBe(FUTURE_ISO);
  });

  it("falls back to the join's tierDisplayName when catalog dictionary misses", () => {
    const info = getSubscriptionDisplayInfo(
      makeSub({
        tierName: "small_business_pro",
        tierDisplayName: "Small Business (Pro)",
      }),
      tierNames, // doesn't include small_business_pro
    );
    expect(info.currentTierDisplayName).toBe("Small Business (Pro)");
  });

  it("surfaces scheduledChange metadata when present", () => {
    const info = getSubscriptionDisplayInfo(
      makeSub({
        tierName: "premium",
        scheduledChange: {
          nextTierName: "basic",
          nextDisplayName: "Basic",
          effectiveAt: "2026-06-01T00:00:00.000Z",
        },
      }),
      tierNames,
    );
    expect(info.hasScheduledChange).toBe(true);
    expect(info.nextTierDisplayName).toBe("Basic");
    expect(info.effectiveAt).toBe("2026-06-01T00:00:00.000Z");
    expect(info.currentTierActiveUntil).toBe(FUTURE_ISO);
  });

  it("uses scheduledChange.nextDisplayName when catalog dictionary misses", () => {
    const info = getSubscriptionDisplayInfo(
      makeSub({
        scheduledChange: {
          nextTierName: "small_business_standard",
          nextDisplayName: "Small Business (Standard)",
          effectiveAt: "2026-06-01T00:00:00.000Z",
        },
      }),
      tierNames,
    );
    expect(info.nextTierDisplayName).toBe("Small Business (Standard)");
  });
});
