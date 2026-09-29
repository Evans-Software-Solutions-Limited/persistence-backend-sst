import type {
  MySubscription,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { getOnboardingBenefits } from "../onboardingBenefits";

const subscription = (overrides: Partial<MySubscription> = {}) =>
  ({
    tierName: "premium",
    workoutLimit: null,
    aiAccess: true,
    isTrainerTier: false,
    trainerClientLimit: null,
    ...overrides,
  }) as MySubscription;

describe("onboarding benefits", () => {
  it("shows Premium access without advertising the adaptive suite or coaching", () => {
    const copy = JSON.stringify(getOnboardingBenefits(subscription()));
    expect(copy).toContain("Unlimited workouts");
    expect(copy).toContain("photo or a description");
    expect(copy).not.toMatch(/Loadout|Mealprint|coaching|clients|programme/);
  });

  it.each<SubscriptionTierName>([
    "premium_plus",
    "start_up_coach_plus",
    "coach",
    "coach_pro",
  ])("includes the adaptive suite for %s", (tierName) => {
    const copy = JSON.stringify(
      getOnboardingBenefits(subscription({ tierName })),
    );
    expect(copy).toContain("Loadout");
    expect(copy).toContain("Mealprint");
    expect(copy).toContain("lighter swaps");
    expect(copy).not.toContain("PDF");
  });

  it("preserves server limits and does not grant Start Up Coach the suite", () => {
    const copy = JSON.stringify(
      getOnboardingBenefits(
        subscription({
          tierName: "individual_trainer",
          isTrainerTier: true,
          trainerClientLimit: 7,
          workoutLimit: 12,
        }),
      ),
    );
    expect(copy).toContain("up to 7 clients");
    expect(copy).toContain("up to 12 custom workouts");
    expect(copy).toContain("Client insights");
    expect(copy).not.toMatch(/Loadout|Mealprint|unlimited/i);
  });

  it("handles unlimited clients and respects disabled AI access", () => {
    const copy = JSON.stringify(
      getOnboardingBenefits(
        subscription({ isTrainerTier: true, aiAccess: false }),
      ),
    );
    expect(copy).toContain("unlimited clients");
    expect(copy).not.toMatch(/Client insights|photo or a description/);
  });
});
