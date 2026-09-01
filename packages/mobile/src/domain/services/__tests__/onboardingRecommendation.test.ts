import type { OnboardingIntentKey } from "@/domain/models/onboarding";
import { recommendOnboardingPlan } from "../onboardingRecommendation";

describe("recommendOnboardingPlan", () => {
  it.each([
    ["nutrition_barcode", "training_three_workouts", "free"],
    ["nutrition_photo_estimate", "training_three_workouts", "premium"],
    ["nutrition_barcode", "training_unlimited_workouts", "premium"],
    ["nutrition_mealprint", "training_unlimited_workouts", "premium_plus"],
    ["nutrition_photo_estimate", "training_loadout", "premium_plus"],
  ] as const)(
    "selects the lowest athlete tier covering %s and %s",
    (nutrition, training, expected) => {
      expect(
        recommendOnboardingPlan({
          path: "athlete",
          coachClientBand: null,
          intentKeys: [nutrition, training],
        }).tierName,
      ).toBe(expected);
    },
  );

  it.each([
    ["1_5", [], "individual_trainer"],
    ["1_5", ["nutrition_mealprint"], "start_up_coach_plus"],
    ["1_5", ["training_loadout"], "start_up_coach_plus"],
    ["6_15", [], "coach"],
    ["16_30", [], "coach_pro"],
  ] as const)(
    "maps coach band %s and intent %j to %s",
    (band, intentKeys, expected) => {
      expect(
        recommendOnboardingPlan({
          path: "coach",
          coachClientBand: band,
          intentKeys: intentKeys as readonly OnboardingIntentKey[],
        }).tierName,
      ).toBe(expected);
    },
  );

  it("does not recommend repurchasing or downgrading a covering paid tier", () => {
    const result = recommendOnboardingPlan({
      path: "athlete",
      coachClientBand: null,
      intentKeys: ["nutrition_photo_estimate", "training_three_workouts"],
      currentTier: "premium_plus",
    });

    expect(result.tierName).toBe("premium_plus");
    expect(result.reasons[0]).toBe(
      "Your current plan already covers these choices",
    );
  });

  it("never compares tiers across athlete and coach rails", () => {
    expect(
      recommendOnboardingPlan({
        path: "coach",
        coachClientBand: "6_15",
        intentKeys: [],
        currentTier: "premium_plus",
      }).tierName,
    ).toBe("coach");
  });

  it("chooses the next live tier when the exact consumer tier is absent", () => {
    expect(
      recommendOnboardingPlan({
        path: "athlete",
        coachClientBand: null,
        intentKeys: ["nutrition_photo_estimate"],
        catalogue: [{ tierName: "free" }, { tierName: "premium_plus" }],
      }).tierName,
    ).toBe("premium_plus");
  });

  it("falls back to Free instead of recommending an unavailable athlete plan", () => {
    expect(
      recommendOnboardingPlan({
        path: "athlete",
        coachClientBand: null,
        intentKeys: ["training_loadout"],
        catalogue: [{ tierName: "free" }],
      }).tierName,
    ).toBe("free");
  });

  it("chooses the lowest available live tier when several cover the minimum", () => {
    expect(
      recommendOnboardingPlan({
        path: "athlete",
        coachClientBand: null,
        intentKeys: [],
        catalogue: [{ tierName: "premium_plus" }, { tierName: "premium" }],
      }).tierName,
    ).toBe("premium");
  });

  it("keeps an exact live tier and a lower current tier does not override it", () => {
    const result = recommendOnboardingPlan({
      path: "athlete",
      coachClientBand: null,
      intentKeys: ["nutrition_mealprint"],
      catalogue: [{ tierName: "premium_plus" }],
      currentTier: "premium",
    });
    expect(result.tierName).toBe("premium_plus");
    expect(result.reasons).toContain("Mealprint meal planning");
  });

  it("keeps an unavailable computed coach tier so existing store fallback can render", () => {
    expect(
      recommendOnboardingPlan({
        path: "coach",
        coachClientBand: null,
        intentKeys: [],
        catalogue: [],
        currentTier: null,
      }),
    ).toEqual({
      tierName: "individual_trainer",
      reasons: ["Support for up to 5 active clients"],
    });
  });

  it("does not add current-plan copy when the recommendation already equals it", () => {
    const result = recommendOnboardingPlan({
      path: "athlete",
      coachClientBand: null,
      intentKeys: [],
      currentTier: "free",
    });
    expect(result).toEqual({ tierName: "free", reasons: [] });
  });
});
