import { fireEvent, render, screen } from "@testing-library/react-native";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import type {
  MySubscription,
  SubscriptionTier,
} from "@/domain/models/subscription";
import {
  deriveTrialEligibility,
  getFeaturesList,
  SubscriptionSelectionPresenter,
  type SubscriptionSelectionPresenterProps,
} from "@/ui/presenters/SubscriptionSelectionPresenter";

const BASIC: SubscriptionTier = {
  tierName: "basic",
  displayName: "Basic",
  description: null,
  priceMonthly: 4.99,
  priceYearly: 49.99,
  currency: "GBP",
  features: {},
  workoutLimit: 10,
  aiAccess: true,
  aiWorkoutLimit: 1,
  gymBuddyAccess: false,
  trainerClientLimit: null,
  isTrainerTier: false,
  analyticsAccess: false,
  exportAccess: false,
  stripePriceIdMonthly: "price_basic_m",
  stripePriceIdYearly: "price_basic_y",
};
const PREMIUM: SubscriptionTier = {
  ...BASIC,
  tierName: "premium",
  displayName: "Premium",
  priceMonthly: 14.99,
  priceYearly: 149.99,
  workoutLimit: null,
  aiWorkoutLimit: 6,
  gymBuddyAccess: true,
};
const TRAINER_STD: SubscriptionTier = {
  ...BASIC,
  tierName: "individual_trainer_standard",
  displayName: "Individual Trainer (Standard)",
  isTrainerTier: true,
  trainerClientLimit: 10,
  priceMonthly: 29,
  priceYearly: 290,
};
const TRAINER_PRO: SubscriptionTier = {
  ...TRAINER_STD,
  tierName: "individual_trainer_pro",
  displayName: "Individual Trainer (Pro)",
  priceMonthly: 59,
  priceYearly: 590,
};

function defaultProps(): SubscriptionSelectionPresenterProps {
  return {
    subscriptionTiers: [BASIC, PREMIUM, TRAINER_STD, TRAINER_PRO],
    isLoading: false,
    errorMessage: null,
    billingCycle: "monthly",
    currentTier: "free",
    selectedRole: "user",
    isTrialEligibleUser: true,
    isTrialEligibleTrainer: true,
    hasTrialEligibilityData: true,
    subscriptionEndsAt: null,
    canCancel: false,
    isCancelledButActive: false,
    scheduledChange: null,
    currentTierDisplayName: "Free",
    selectedTierForPayment: null,
    isProcessingSubscription: false,
    paymentFormProps: null,
    payments: new MockPaymentsAdapter(),
    onBillingCycleChange: jest.fn(),
    onTierSelect: jest.fn(),
    onRoleChange: jest.fn(),
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onCancelSubscription: jest.fn(),
    onPaymentMethodReady: jest.fn(),
    onPaymentMethodError: jest.fn(),
  };
}

describe("SubscriptionSelectionPresenter — render states", () => {
  it("renders the loading state when isLoading", () => {
    render(<SubscriptionSelectionPresenter {...defaultProps()} isLoading />);
    expect(screen.getByTestId("subscription-selection-loading")).toBeTruthy();
    expect(screen.getByText("Loading subscription options...")).toBeTruthy();
  });

  it("renders the error state with retry button when errorMessage set", () => {
    const onRetry = jest.fn();
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        errorMessage="Network down"
        onRetry={onRetry}
      />,
    );
    expect(
      screen.getByText("Failed to Load Subscription Options"),
    ).toBeTruthy();
    expect(screen.getByText("Network down")).toBeTruthy();
    fireEvent.press(screen.getByTestId("subscription-selection-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders user tier cards (basic + premium) by default", () => {
    render(<SubscriptionSelectionPresenter {...defaultProps()} />);
    expect(screen.getByTestId("subscription-card-basic")).toBeTruthy();
    expect(screen.getByTestId("subscription-card-premium")).toBeTruthy();
    // Free is never rendered.
    expect(screen.queryByTestId("subscription-card-free")).toBeNull();
  });

  it("renders trainer cards when selectedRole is 'trainer'", () => {
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        selectedRole="trainer"
      />,
    );
    expect(
      screen.getByTestId(
        "trainer-subscription-card-individual_trainer_standard",
      ),
    ).toBeTruthy();
  });

  it("shows the empty-state message when trainer role has no available cards", () => {
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        subscriptionTiers={[BASIC, PREMIUM]}
        selectedRole="trainer"
      />,
    );
    expect(
      screen.getByText(/No trainer subscription tiers available/),
    ).toBeTruthy();
  });

  it("renders Current status card when on a paid tier", () => {
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        currentTier="premium"
        currentTierDisplayName="Premium"
      />,
    );
    expect(screen.getByTestId("current-subscription-status-card")).toBeTruthy();
  });

  it("renders the processing overlay during isProcessingSubscription", () => {
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        isProcessingSubscription
      />,
    );
    expect(
      screen.getByTestId("subscription-selection-processing"),
    ).toBeTruthy();
  });
});

describe("SubscriptionSelectionPresenter — interactions", () => {
  it("fires onTierSelect when a basic card is tapped", () => {
    const onTierSelect = jest.fn();
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        onTierSelect={onTierSelect}
      />,
    );
    fireEvent.press(screen.getByTestId("subscription-card-basic-subscribe"));
    expect(onTierSelect).toHaveBeenCalledWith("basic");
  });

  it("fires onRoleChange when role toggle pressed (user + trainer)", () => {
    const onRoleChange = jest.fn();
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        selectedRole="trainer"
        onRoleChange={onRoleChange}
      />,
    );
    fireEvent.press(screen.getByTestId("role-toggle-user"));
    expect(onRoleChange).toHaveBeenCalledWith("user");
    fireEvent.press(screen.getByTestId("role-toggle-trainer"));
    expect(onRoleChange).toHaveBeenCalledWith("trainer");
  });

  it("toggles billing cycle on tap", () => {
    const onBillingCycleChange = jest.fn();
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        onBillingCycleChange={onBillingCycleChange}
      />,
    );
    fireEvent.press(screen.getByTestId("billing-cycle-toggle"));
    expect(onBillingCycleChange).toHaveBeenCalledWith("yearly");
  });

  it("fires onBack from the back button", () => {
    const onBack = jest.fn();
    render(
      <SubscriptionSelectionPresenter {...defaultProps()} onBack={onBack} />,
    );
    fireEvent.press(screen.getByTestId("subscription-selection-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows the cancel button when canCancel && !isCancelledButActive", () => {
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        currentTier="premium"
        canCancel
      />,
    );
    expect(screen.getByTestId("cancel-subscription-button")).toBeTruthy();
  });

  it("hides the cancel button when isCancelledButActive (reinstate path)", () => {
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        currentTier="premium"
        canCancel
        isCancelledButActive
      />,
    );
    expect(screen.queryByTestId("cancel-subscription-button")).toBeNull();
  });
});

describe("getFeaturesList", () => {
  it("derives trainer features (client slots, analytics, AI Buddy on pro)", () => {
    const features = getFeaturesList(TRAINER_PRO, true);
    expect(features).toContain("10 client slots");
    expect(features).toContain("AI Buddy Included");
  });

  it("falls back to ai_buddy flag when tierName doesn't end in _pro", () => {
    const features = getFeaturesList(
      { ...TRAINER_STD, features: { ai_buddy: true } },
      true,
    );
    expect(features).toContain("AI Buddy Included");
  });

  it("includes analytics when analyticsAccess flag is set", () => {
    const features = getFeaturesList(
      { ...TRAINER_STD, analyticsAccess: true },
      true,
    );
    expect(features).toContain("Analytics & Reporting");
  });

  it("includes data export when exportAccess flag is set", () => {
    const features = getFeaturesList(
      { ...TRAINER_STD, exportAccess: true },
      true,
    );
    expect(features).toContain("Data Export");
  });

  it("derives user-tier features for premium (unlimited workouts + 6 AI + gym buddy)", () => {
    const features = getFeaturesList(PREMIUM, false);
    expect(features).toContain("Unlimited workouts");
    expect(features).toContain("6 AI workouts per month");
    expect(features.some((f) => f.includes("Reps Gym Buddy"))).toBe(true);
  });

  it("derives user-tier features for basic (10 workouts + 1 AI workout)", () => {
    const features = getFeaturesList(BASIC, false);
    expect(features.some((f) => f.includes("workouts per month"))).toBe(true);
    expect(features).toContain("1 AI workout per month");
  });

  it("uses features.workouts === 'unlimited' as the unlimited signal", () => {
    const features = getFeaturesList(
      { ...BASIC, workoutLimit: 10, features: { workouts: "unlimited" } },
      false,
    );
    expect(features).toContain("Unlimited workouts");
  });

  it("uses numeric features.workouts value when present", () => {
    const features = getFeaturesList(
      { ...BASIC, workoutLimit: 10, features: { workouts: 25 } },
      false,
    );
    expect(features).toContain("25 workouts per month");
  });

  it("falls back to workoutLimit when features.workouts is absent and aiWorkout label is custom", () => {
    const tier = {
      ...BASIC,
      tierName: "free" as const,
      workoutLimit: 5,
      features: { ai: true },
      aiAccess: true,
    };
    const features = getFeaturesList(tier, false);
    expect(features).toContain("5 workouts per month");
    expect(features).toContain("AI workout generation");
  });

  it("adds Progress tracking when features.progress is true", () => {
    const features = getFeaturesList(
      { ...BASIC, features: { progress: true } },
      false,
    );
    expect(features).toContain("Progress tracking");
  });
});

describe("deriveTrialEligibility", () => {
  const baseSub: MySubscription = {
    subscriptionId: "us_1",
    tierName: "premium",
    paymentStatus: "trialing",
    billingCycle: "monthly",
    startsAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z",
    cancelledAt: "2026-05-01T00:00:00.000Z",
    trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    externalSubscriptionId: "sub_1",
    tierDisplayName: "Premium",
    tierDescription: null,
    workoutLimit: null,
    aiAccess: true,
    aiWorkoutLimit: 6,
    gymBuddyAccess: true,
    trainerClientLimit: null,
    isTrainerTier: false,
    role: "user",
    hasUsedUserTrial: true,
    hasUsedTrainerTrial: false,
    isEligibleForUserTrial: false,
    isEligibleForTrainerTrial: true,
    scheduledChange: null,
  };

  it("returns 7-day trial for 'premium' when eligible (not reinstating)", () => {
    expect(
      deriveTrialEligibility({
        tierName: "premium",
        isReinstatingCurrentTier: false,
        subscription: null,
        isTrialEligibleUser: true,
        isTrialEligibleTrainer: false,
      }),
    ).toEqual({ isTrialEligible: true, trialDuration: 7 });
  });

  it("returns null trial for 'premium' when ineligible", () => {
    expect(
      deriveTrialEligibility({
        tierName: "premium",
        isReinstatingCurrentTier: false,
        subscription: null,
        isTrialEligibleUser: false,
        isTrialEligibleTrainer: false,
      }),
    ).toEqual({ isTrialEligible: false, trialDuration: null });
  });

  it("returns 14-day trial for _pro tiers when eligible", () => {
    expect(
      deriveTrialEligibility({
        tierName: "individual_trainer_pro",
        isReinstatingCurrentTier: false,
        subscription: null,
        isTrialEligibleUser: false,
        isTrialEligibleTrainer: true,
      }),
    ).toEqual({ isTrialEligible: true, trialDuration: 14 });
  });

  it("returns no-trial for non-trial tiers (basic, standard trainer tiers)", () => {
    expect(
      deriveTrialEligibility({
        tierName: "basic",
        isReinstatingCurrentTier: false,
        subscription: null,
        isTrialEligibleUser: true,
        isTrialEligibleTrainer: true,
      }),
    ).toEqual({ isTrialEligible: false, trialDuration: null });
  });

  it("preserves remaining trial days when reinstating cancelled-in-trial subscription", () => {
    const result = deriveTrialEligibility({
      tierName: "premium",
      isReinstatingCurrentTier: true,
      subscription: baseSub,
      isTrialEligibleUser: false,
      isTrialEligibleTrainer: false,
    });
    expect(result.isTrialEligible).toBe(true);
    expect(result.trialDuration).toBeGreaterThanOrEqual(4);
    expect(result.trialDuration).toBeLessThanOrEqual(6);
  });

  it("falls through to tier-eligibility when not reinstating, even with trialEndsAt set", () => {
    expect(
      deriveTrialEligibility({
        tierName: "premium",
        isReinstatingCurrentTier: false,
        subscription: baseSub,
        isTrialEligibleUser: false,
        isTrialEligibleTrainer: false,
      }),
    ).toEqual({ isTrialEligible: false, trialDuration: null });
  });

  it("does not apply remaining-days when trial has already expired", () => {
    const expired = {
      ...baseSub,
      trialEndsAt: new Date(Date.now() - 1000).toISOString(),
    };
    const result = deriveTrialEligibility({
      tierName: "premium",
      isReinstatingCurrentTier: true,
      subscription: expired,
      isTrialEligibleUser: false,
      isTrialEligibleTrainer: false,
    });
    // Falls through to user-eligibility flag (false), giving no trial.
    expect(result).toEqual({ isTrialEligible: false, trialDuration: null });
  });
});
