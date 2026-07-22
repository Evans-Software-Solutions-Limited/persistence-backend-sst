import { fireEvent, render, screen } from "@testing-library/react-native";
import type { SubscriptionTier } from "@/domain/models/subscription";
import {
  IOSPurchaseFlowPresenter,
  type IOSPurchaseFlowPresenterProps,
} from "@/ui/presenters/IOSPurchaseFlowPresenter";

const PREMIUM: SubscriptionTier = {
  tierName: "premium",
  displayName: "Premium",
  description: null,
  priceMonthly: 9.99,
  priceYearly: 99.99,
  currency: "GBP",
  features: { gym_buddy: true, progress: true, ai: true },
  workoutLimit: null,
  aiAccess: true,
  aiWorkoutLimit: 6,
  gymBuddyAccess: true,
  trainerClientLimit: null,
  isTrainerTier: false,
  analyticsAccess: false,
  exportAccess: false,
  stripePriceIdMonthly: null,
  stripePriceIdYearly: null,
};
const INDIVIDUAL_TRAINER: SubscriptionTier = {
  ...PREMIUM,
  tierName: "individual_trainer",
  displayName: "Individual Trainer",
  isTrainerTier: true,
  trainerClientLimit: 2,
};

function defaultProps(): IOSPurchaseFlowPresenterProps {
  return {
    subscriptionTiers: [PREMIUM, INDIVIDUAL_TRAINER],
    isLoading: false,
    errorMessage: null,
    isUnavailable: false,
    billingCycle: "monthly",
    currentTier: "free",
    selectedRole: "user",
    purchasableTiers: new Set(["premium", "individual_trainer"]),
    isTierTrialEligible: () => true,
    tierTrialDays: () => 14,
    hasTrialEligibilityData: true,
    contactSalesTiers: new Set(["small_business", "medium_enterprise"]),
    onContactSales: jest.fn(),
    subscriptionEndsAt: null,
    isCancelledButActive: false,
    currentTierDisplayName: "Free",
    isProcessing: false,
    isRestoring: false,
    onBillingCycleChange: jest.fn(),
    onTierSelect: jest.fn(),
    onRoleChange: jest.fn(),
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onRestore: jest.fn(),
    onManageInAppStore: jest.fn(),
  };
}

describe("IOSPurchaseFlowPresenter", () => {
  it("shows the loading state", () => {
    render(<IOSPurchaseFlowPresenter {...defaultProps()} isLoading />);
    expect(screen.getByTestId("ios-purchase-loading")).toBeTruthy();
  });

  it("shows the error state and retries", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} errorMessage="boom" />);
    fireEvent.press(screen.getByTestId("ios-purchase-retry"));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("renders the premium card and dispatches tier select", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} />);
    expect(screen.getByTestId("subscription-card-premium")).toBeTruthy();
    fireEvent.press(screen.getByTestId("subscription-card-premium-subscribe"));
    expect(props.onTierSelect).toHaveBeenCalledWith("premium");
  });

  it("advertises EACH tier's own trial length (per-tier, not one global number)", () => {
    // Regression: previously one product's offer was stamped on every card, so
    // a premium 1-week offer could render as a trainer's "14-day". The premium
    // (user) card must show ITS product's 7 days and never a trainer's 14.
    render(
      <IOSPurchaseFlowPresenter
        {...defaultProps()}
        selectedRole="user"
        tierTrialDays={(tier) => (tier === "premium" ? 7 : 14)}
      />,
    );
    expect(screen.getByText("7-day free trial")).toBeTruthy();
    expect(screen.queryByText("14-day free trial")).toBeNull();
  });

  it("shows the trial banner per-tier — only on tiers whose own product is eligible", () => {
    const SMALL_BUSINESS: SubscriptionTier = {
      ...PREMIUM,
      tierName: "small_business",
      displayName: "Small Business",
      isTrainerTier: true,
    };
    const props = defaultProps();
    render(
      <IOSPurchaseFlowPresenter
        {...props}
        subscriptionTiers={[PREMIUM, INDIVIDUAL_TRAINER, SMALL_BUSINESS]}
        selectedRole="trainer"
        billingCycle="monthly"
        // Only individual_trainer is eligible; small_business is not.
        isTierTrialEligible={(tier) => tier === "individual_trainer"}
      />,
    );
    // Exactly one trainer card shows the banner (individual_trainer), not SB.
    expect(screen.getAllByText("14-day free trial")).toHaveLength(1);
  });

  it("renders DIFFERENT trial durations across trainer cards (each from its own product)", () => {
    // Locks the per-tier guarantee: two simultaneously-eligible trainer cards
    // must each show THEIR product's duration, not a single shared number.
    const SMALL_BUSINESS: SubscriptionTier = {
      ...PREMIUM,
      tierName: "small_business",
      displayName: "Small Business",
      isTrainerTier: true,
    };
    render(
      <IOSPurchaseFlowPresenter
        {...defaultProps()}
        subscriptionTiers={[PREMIUM, INDIVIDUAL_TRAINER, SMALL_BUSINESS]}
        selectedRole="trainer"
        billingCycle="monthly"
        isTierTrialEligible={() => true}
        tierTrialDays={(tier) =>
          tier === "individual_trainer"
            ? 14
            : tier === "small_business"
              ? 7
              : null
        }
      />,
    );
    // Both distinct durations render at once; medium_enterprise (null) shows none.
    expect(screen.getByText("14-day free trial")).toBeTruthy();
    expect(screen.getByText("7-day free trial")).toBeTruthy();
  });

  it("renders trainer cards under the trainer role", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} selectedRole="trainer" />);
    expect(
      screen.getByTestId("trainer-subscription-card-individual_trainer"),
    ).toBeTruthy();
  });

  it("shows Contact Sales (not Subscribe) for a contact-sales tier on the yearly cycle", () => {
    const MEDIUM_ENTERPRISE: SubscriptionTier = {
      ...PREMIUM,
      tierName: "medium_enterprise",
      displayName: "Medium Enterprise",
      isTrainerTier: true,
      priceYearly: null,
    };
    const props = defaultProps();
    render(
      <IOSPurchaseFlowPresenter
        {...props}
        subscriptionTiers={[PREMIUM, INDIVIDUAL_TRAINER, MEDIUM_ENTERPRISE]}
        selectedRole="trainer"
        billingCycle="yearly"
      />,
    );
    fireEvent.press(screen.getByTestId("trainer-card-medium_enterprise-pro"));
    expect(props.onContactSales).toHaveBeenCalledWith("medium_enterprise");
    // Individual Trainer keeps a normal purchase (has a yearly product).
    expect(screen.getByText("Contact Sales")).toBeTruthy();
  });

  it("does NOT show Contact Sales for a contact-sales tier on the monthly cycle", () => {
    const MEDIUM_ENTERPRISE: SubscriptionTier = {
      ...PREMIUM,
      tierName: "medium_enterprise",
      displayName: "Medium Enterprise",
      isTrainerTier: true,
    };
    const props = defaultProps();
    render(
      <IOSPurchaseFlowPresenter
        {...props}
        subscriptionTiers={[PREMIUM, INDIVIDUAL_TRAINER, MEDIUM_ENTERPRISE]}
        selectedRole="trainer"
        billingCycle="monthly"
      />,
    );
    fireEvent.press(screen.getByTestId("trainer-card-medium_enterprise-pro"));
    expect(props.onContactSales).not.toHaveBeenCalled();
    expect(props.onTierSelect).toHaveBeenCalledWith("medium_enterprise");
  });

  it("invokes restore", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} />);
    fireEvent.press(screen.getByTestId("ios-purchase-restore"));
    expect(props.onRestore).toHaveBeenCalled();
  });

  it("toggles billing cycle and role", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} />);
    fireEvent.press(screen.getByTestId("billing-cycle-toggle"));
    expect(props.onBillingCycleChange).toHaveBeenCalledWith("yearly");
    fireEvent.press(screen.getByTestId("role-toggle-trainer"));
    expect(props.onRoleChange).toHaveBeenCalledWith("trainer");
  });

  it("shows Manage in App Store + status card only for a paid tier", () => {
    const props = defaultProps();
    const { rerender } = render(<IOSPurchaseFlowPresenter {...props} />);
    expect(screen.queryByTestId("ios-purchase-manage")).toBeNull();

    rerender(
      <IOSPurchaseFlowPresenter
        {...props}
        currentTier="premium"
        currentTierDisplayName="Premium"
      />,
    );
    fireEvent.press(screen.getByTestId("ios-purchase-manage"));
    expect(props.onManageInAppStore).toHaveBeenCalled();
  });

  it("shows the inline unavailable notice", () => {
    render(<IOSPurchaseFlowPresenter {...defaultProps()} isUnavailable />);
    expect(screen.getByTestId("ios-purchase-unavailable")).toBeTruthy();
  });

  it("shows the back affordance", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} />);
    fireEvent.press(screen.getByTestId("ios-purchase-back"));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("notes when no trainer tier is purchasable yet", () => {
    const props = defaultProps();
    render(
      <IOSPurchaseFlowPresenter
        {...props}
        selectedRole="trainer"
        purchasableTiers={new Set()}
      />,
    );
    expect(screen.getByTestId("ios-purchase-tier-note")).toBeTruthy();
  });

  it("exposes accessible names/state for the back control and the billing-cycle switch", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} />);
    expect(screen.getByLabelText("Go back")).toBeTruthy();
    const toggle = screen.getByLabelText("Billing cycle");
    expect(toggle.props.accessibilityRole).toBe("switch");
    expect(toggle.props.accessibilityState).toEqual({ checked: false });
  });
});
