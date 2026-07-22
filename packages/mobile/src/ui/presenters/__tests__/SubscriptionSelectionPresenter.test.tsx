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

const PREMIUM: SubscriptionTier = {
  tierName: "premium",
  displayName: "Premium",
  description: null,
  priceMonthly: 12.99,
  priceYearly: 129.99,
  currency: "GBP",
  features: { gym_buddy: true, progress: true },
  workoutLimit: null,
  aiAccess: true,
  aiWorkoutLimit: 6,
  gymBuddyAccess: true,
  trainerClientLimit: null,
  isTrainerTier: false,
  analyticsAccess: false,
  exportAccess: false,
  stripePriceIdMonthly: "price_premium_m",
  stripePriceIdYearly: "price_premium_y",
};
const INDIVIDUAL_TRAINER: SubscriptionTier = {
  ...PREMIUM,
  tierName: "individual_trainer",
  displayName: "Individual Trainer",
  isTrainerTier: true,
  trainerClientLimit: 2,
  priceMonthly: 14.99,
  priceYearly: 149.99,
  analyticsAccess: true,
  exportAccess: true,
  features: { ai_buddy: true, trainer_clients: 2 },
};
const SMALL_BUSINESS: SubscriptionTier = {
  ...INDIVIDUAL_TRAINER,
  tierName: "small_business",
  displayName: "Small Business Trainer",
  trainerClientLimit: 30,
  priceMonthly: 75,
  priceYearly: 750,
};

function defaultProps(): SubscriptionSelectionPresenterProps {
  return {
    subscriptionTiers: [PREMIUM, INDIVIDUAL_TRAINER, SMALL_BUSINESS],
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
    isOffline: false,
    isSlowLoading: false,
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

  it("renders the slow-loading indicator when isSlowLoading && isLoading (M10.5 AC 11.3)", () => {
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        isLoading
        isSlowLoading
      />,
    );
    expect(
      screen.getByTestId("subscription-selection-slow-loading"),
    ).toBeTruthy();
    expect(
      screen.getByText("Still loading subscription information..."),
    ).toBeTruthy();
  });

  it("renders the offline banner when isOffline (M10.5 AC 11.1)", () => {
    render(<SubscriptionSelectionPresenter {...defaultProps()} isOffline />);
    expect(screen.getByTestId("subscription-offline-banner")).toBeTruthy();
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

  it("renders the premium user tier card by default (post tier-simplification — Basic dropped)", () => {
    render(<SubscriptionSelectionPresenter {...defaultProps()} />);
    expect(screen.getByTestId("subscription-card-premium")).toBeTruthy();
    // Free and the dropped basic tier are never rendered.
    expect(screen.queryByTestId("subscription-card-free")).toBeNull();
    expect(screen.queryByTestId("subscription-card-basic")).toBeNull();
  });

  it("renders trainer cards when selectedRole is 'trainer'", () => {
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        selectedRole="trainer"
      />,
    );
    expect(
      screen.getByTestId("trainer-subscription-card-individual_trainer"),
    ).toBeTruthy();
  });

  it("shows the empty-state message when trainer role has no available cards", () => {
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        subscriptionTiers={[PREMIUM]}
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
  it("fires onTierSelect when the premium card is tapped", () => {
    const onTierSelect = jest.fn();
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        onTierSelect={onTierSelect}
      />,
    );
    fireEvent.press(screen.getByTestId("subscription-card-premium-subscribe"));
    expect(onTierSelect).toHaveBeenCalledWith("premium");
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
  it("derives trainer features (client slots, analytics, AI Buddy — post tier-simplification, all trainer tiers carry the former Pro entitlements)", () => {
    const features = getFeaturesList(INDIVIDUAL_TRAINER, true);
    expect(features).toContain("2 client slots");
    expect(features).toContain("AI Buddy Included");
  });

  it("includes analytics when analyticsAccess flag is set", () => {
    const features = getFeaturesList(
      { ...INDIVIDUAL_TRAINER, analyticsAccess: true },
      true,
    );
    expect(features).toContain("Analytics & Reporting");
  });

  it("includes data export when exportAccess flag is set", () => {
    const features = getFeaturesList(
      { ...INDIVIDUAL_TRAINER, exportAccess: true },
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

  it("uses features.workouts === 'unlimited' as the unlimited signal", () => {
    const features = getFeaturesList(
      { ...PREMIUM, workoutLimit: 10, features: { workouts: "unlimited" } },
      false,
    );
    expect(features).toContain("Unlimited workouts");
  });

  it("uses numeric features.workouts value when present", () => {
    const features = getFeaturesList(
      { ...PREMIUM, workoutLimit: 10, features: { workouts: 25 } },
      false,
    );
    expect(features).toContain("25 workouts per month");
  });

  it("falls back to workoutLimit when features.workouts is absent — generic AI label for non-premium", () => {
    const tier = {
      ...PREMIUM,
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
      { ...PREMIUM, features: { progress: true } },
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

  it("returns a DEFAULT_TRIAL_DAYS (7) trial for 'premium' when eligible (consistent across all tiers)", () => {
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

  it("returns DEFAULT_TRIAL_DAYS (7) trial for any trainer tier when eligible (post tier-simplification — all trainer tiers carry the former Pro entitlements)", () => {
    expect(
      deriveTrialEligibility({
        tierName: "individual_trainer",
        isReinstatingCurrentTier: false,
        subscription: null,
        isTrialEligibleUser: false,
        isTrialEligibleTrainer: true,
      }),
    ).toEqual({ isTrialEligible: true, trialDuration: 7 });
    expect(
      deriveTrialEligibility({
        tierName: "small_business",
        isReinstatingCurrentTier: false,
        subscription: null,
        isTrialEligibleUser: false,
        isTrialEligibleTrainer: true,
      }),
    ).toEqual({ isTrialEligible: true, trialDuration: 7 });
  });

  it("returns no-trial for the free tier", () => {
    expect(
      deriveTrialEligibility({
        tierName: "free",
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

describe("SubscriptionSelectionPresenter — accessibility", () => {
  it("exposes accessible names/state for the back control and the billing-cycle switch", () => {
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        billingCycle="yearly"
      />,
    );
    expect(screen.getByLabelText("Go back")).toBeTruthy();
    const toggle = screen.getByLabelText("Billing cycle");
    expect(toggle.props.accessibilityRole).toBe("switch");
    expect(toggle.props.accessibilityState).toEqual({ checked: true });
  });
});
