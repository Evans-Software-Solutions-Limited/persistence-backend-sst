import { fireEvent, render, screen } from "@testing-library/react-native";
import type {
  MySubscription,
  SubscriptionTier,
} from "@/domain/models/subscription";
import {
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
const PREMIUM_PLUS: SubscriptionTier = {
  ...PREMIUM,
  tierName: "premium_plus",
  displayName: "Premium+",
  priceMonthly: 29.99,
  priceYearly: 299.99,
  aiWorkoutLimit: 30,
  stripePriceIdMonthly: null,
  stripePriceIdYearly: null,
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
    onBillingCycleChange: jest.fn(),
    onTierSelect: jest.fn(),
    onRoleChange: jest.fn(),
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onCancelSubscription: jest.fn(),
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

  it("renders exactly one consumer card when the catalog has no premium_plus row (M19-P0 — pre-existing catalog shape is unaffected)", () => {
    render(<SubscriptionSelectionPresenter {...defaultProps()} />);
    expect(screen.getByTestId("subscription-card-premium")).toBeTruthy();
    expect(screen.queryByTestId("subscription-card-premium_plus")).toBeNull();
  });

  it("renders a second consumer card, cheapest-first, when the catalog includes premium_plus (M19-P0)", () => {
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        subscriptionTiers={[
          PREMIUM_PLUS,
          PREMIUM,
          INDIVIDUAL_TRAINER,
          SMALL_BUSINESS,
        ]}
      />,
    );
    expect(screen.getByTestId("subscription-card-premium")).toBeTruthy();
    expect(screen.getByTestId("subscription-card-premium_plus")).toBeTruthy();
    // Cheapest-first ordering (ascending priceMonthly) — premium (£12.99)
    // renders before premium_plus (£29.99) regardless of catalog order.
    const premiumCard = screen.getByTestId("subscription-card-premium");
    const premiumPlusCard = screen.getByTestId(
      "subscription-card-premium_plus",
    );
    const allCardTestIds = screen
      .getAllByTestId(/^subscription-card-/)
      .map((el) => el.props.testID);
    expect(allCardTestIds.indexOf("subscription-card-premium")).toBeLessThan(
      allCardTestIds.indexOf("subscription-card-premium_plus"),
    );
    expect(premiumCard).toBeTruthy();
    expect(premiumPlusCard).toBeTruthy();
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

describe("SubscriptionSelectionPresenter — comped tier not in catalog", () => {
  it("suppresses trial banners when the user holds a paid tier missing from the catalog", () => {
    // Mirrors the iOS-rail guard. A promotional premium_plus grant while
    // the tier is still seeded is_active=false never reaches the catalog,
    // so no card is marked current — without the guard every cheaper card
    // renders as a buyable free trial and can nudge a comped user onto a
    // worse tier than the one they were given.
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        currentTier="premium_plus"
      />,
    );
    expect(screen.queryByText(/free trial/i)).toBeNull();
  });

  it("suppresses trainer-card trial banners in the same state", () => {
    // The trainer loop resolves fixed tier names out of the catalog and has
    // the identical hole — a held-but-unlisted tier marks no card current,
    // so every trainer card would offer a trial.
    render(
      <SubscriptionSelectionPresenter
        {...defaultProps()}
        selectedRole="trainer"
        currentTier="premium_plus"
      />,
    );
    expect(screen.queryByText(/free trial/i)).toBeNull();
  });
});

describe("getFeaturesList", () => {
  it("derives trainer features (client slots + AI Buddy — no analytics/export, neither is built)", () => {
    const features = getFeaturesList(INDIVIDUAL_TRAINER, true);
    expect(features).toContain("2 client slots");
    expect(features).toContain("AI Buddy Included");
  });

  // Brad, 2026-07-25: neither analytics nor export is a built feature —
  // nothing gates an analytics screen or an export path on these flags, so
  // the paywall must not sell them. Inverted from the old tests, which
  // asserted the bullets WERE rendered.
  it("never advertises analytics or export, even when the catalog flags are set", () => {
    const features = getFeaturesList(
      { ...INDIVIDUAL_TRAINER, analyticsAccess: true, exportAccess: true },
      true,
    );
    expect(features).not.toContain("Analytics & Reporting");
    expect(features).not.toContain("Data Export");
    // The rows that ARE real still render.
    expect(features).toContain("2 client slots");
    expect(features).toContain("AI Buddy Included");
  });

  it("derives user-tier features for premium — AI nutrition logging, no unbuilt claims", () => {
    const features = getFeaturesList(PREMIUM, false);
    expect(features).toContain("Unlimited workouts");
    expect(features).toContain(
      "AI nutrition logging from a photo or free text",
    );
    // Neither exists (Brad, 2026-07-25): no workout-generation path, and
    // gym_buddy is an entitlement stub with no backend surface or UI.
    expect(features.some((f) => f.includes("AI workouts per month"))).toBe(
      false,
    );
    expect(features.some((f) => f.includes("Gym Buddy"))).toBe(false);
  });

  // M19-P0: Premium+ costs 2.3x Premium, and without these two rows its
  // card renders bullets byte-identical to Premium's apart from the AI
  // count — i.e. the flagship's entire value proposition is missing at the
  // point of sale. Driven off the catalog `features` JSONB, not tier name.
  it("renders the adaptive-suite rows for a tier whose catalog features include them", () => {
    const premiumPlus = {
      ...PREMIUM,
      tierName: "premium_plus" as const,
      aiWorkoutLimit: 30,
      features: {
        workouts: "unlimited",
        progress: true,
        loadout: true,
        mealprint: true,
      },
    };
    const features = getFeaturesList(premiumPlus, false);
    expect(features.some((f) => f.startsWith("Loadout"))).toBe(true);
    expect(features.some((f) => f.startsWith("Mealprint"))).toBe(true);
    // ...and it is genuinely differentiated from the tier below it.
    expect(features).not.toEqual(getFeaturesList(PREMIUM, false));
  });

  it("omits the adaptive-suite rows for a tier whose catalog features lack them", () => {
    const features = getFeaturesList(PREMIUM, false);
    expect(features.some((f) => f.startsWith("Loadout"))).toBe(false);
    expect(features.some((f) => f.startsWith("Mealprint"))).toBe(false);
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

  it("falls back to workoutLimit when features.workouts is absent", () => {
    const tier = {
      ...PREMIUM,
      tierName: "free" as const,
      workoutLimit: 5,
      features: { ai: true },
      aiAccess: true,
    };
    const features = getFeaturesList(tier, false);
    expect(features).toContain("5 workouts per month");
    expect(features).toContain(
      "AI nutrition logging from a photo or free text",
    );
  });

  it("adds Progress tracking when features.progress is true", () => {
    const features = getFeaturesList(
      { ...PREMIUM, features: { progress: true } },
      false,
    );
    expect(features).toContain("Progress tracking");
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
