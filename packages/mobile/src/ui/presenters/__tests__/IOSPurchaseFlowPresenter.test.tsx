import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { SubscriptionTier } from "@/domain/models/subscription";
import {
  IOSPurchaseFlowPresenter,
  Price,
  type IOSPurchaseFlowPresenterProps,
} from "@/ui/presenters/IOSPurchaseFlowPresenter";
import { catalogTier } from "@persistence/subscription-catalog";

const PREMIUM: SubscriptionTier = {
  tierName: "premium",
  displayName: "Premium",
  description: null,
  priceMonthly: 16.99,
  priceYearly: 139.99,
  currency: "GBP",
  features: {},
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

function defaultProps(): IOSPurchaseFlowPresenterProps {
  return {
    subscriptionTiers: [PREMIUM],
    isLoading: false,
    errorMessage: null,
    isUnavailable: false,
    billingCycle: "yearly",
    currentTier: "free",
    selectedRole: "user",
    purchasableTiers: new Set(),
    isTierTrialEligible: () => false,
    tierTrialDays: () => null,
    hasTrialEligibilityData: false,
    monthlyOnlyTiers: new Set(),
    subscriptionEndsAt: null,
    isCancelledButActive: false,
    currentTierDisplayName: "Free",
    isProcessing: false,
    isRestoring: false,
    screen: "plans",
    onBillingCycleChange: jest.fn(),
    onTierSelect: jest.fn(),
    onRoleChange: jest.fn(),
    onPersonaSelect: jest.fn(),
    onChangePlan: jest.fn(),
    onContinueFree: jest.fn(),
    onBack: jest.fn(),
    onRetry: jest.fn(),
    onRestore: jest.fn(),
    onManageInAppStore: jest.fn(),
  };
}

describe("IOSPurchaseFlowPresenter", () => {
  it("renders loading and error states", () => {
    const props = defaultProps();
    const view = render(<IOSPurchaseFlowPresenter {...props} isLoading />);
    expect(screen.getByTestId("ios-purchase-loading")).toBeTruthy();

    view.rerender(
      <IOSPurchaseFlowPresenter
        {...props}
        errorMessage="catalog unavailable"
      />,
    );
    expect(screen.getByText("catalog unavailable")).toBeTruthy();
    fireEvent.press(screen.getByTestId("ios-purchase-retry"));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("routes all three persona choices and explains the single coach plan", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} screen="persona" />);

    fireEvent.press(screen.getByTestId("persona-self"));
    fireEvent.press(screen.getByTestId("persona-coach"));
    fireEvent.press(screen.getByTestId("persona-both"));
    expect(props.onPersonaSelect).toHaveBeenNthCalledWith(1, "user");
    expect(props.onPersonaSelect).toHaveBeenNthCalledWith(2, "trainer");
    expect(props.onPersonaSelect).toHaveBeenNthCalledWith(3, "trainer");
    expect(screen.getAllByText(/one coach plan/i).length).toBeGreaterThan(0);
  });

  it("renders every individual tier from the launch catalog", () => {
    render(<IOSPurchaseFlowPresenter {...defaultProps()} />);
    expect(screen.getByTestId("subscription-card-free")).toBeTruthy();
    expect(screen.getByTestId("subscription-card-premium")).toBeTruthy();
    expect(screen.getByTestId("subscription-card-premium_plus")).toBeTruthy();
    expect(screen.getByText("£139.99")).toBeTruthy();
    expect(screen.getByText("£249.99")).toBeTruthy();
    expect(screen.getAllByText(/save 31%/i).length).toBeGreaterThan(0);
  });

  it("renders every paid IAP action as non-interactive Coming soon", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} />);
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
    expect(screen.queryByText("Subscribe")).toBeNull();
    expect(props.onTierSelect).not.toHaveBeenCalled();
  });

  it("continues free without treating it as an IAP", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} />);
    fireEvent.press(screen.getByTestId("subscription-card-free-continue"));
    expect(props.onContinueFree).toHaveBeenCalled();
  });

  it("switches cadence and audience", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} />);
    fireEvent.press(screen.getByText("Monthly"));
    fireEvent.press(screen.getByTestId("role-toggle-trainer"));
    expect(props.onBillingCycleChange).toHaveBeenCalledWith("monthly");
    expect(props.onRoleChange).toHaveBeenCalledWith("trainer");
  });

  it("renders the coach ladder, suite split and web-only organisation readout", () => {
    render(
      <IOSPurchaseFlowPresenter
        {...defaultProps()}
        selectedRole="trainer"
        billingCycle="monthly"
      />,
    );
    expect(
      screen.getByTestId("trainer-subscription-card-individual_trainer"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("trainer-subscription-card-start_up_coach_plus"),
    ).toBeTruthy();
    expect(screen.getByTestId("trainer-subscription-card-coach")).toBeTruthy();
    expect(
      screen.getByTestId("trainer-subscription-card-coach_pro"),
    ).toBeTruthy();
    expect(screen.getAllByText("Adaptive suite not included")).toHaveLength(1);
    expect(screen.getAllByText("Loadout + Mealprint included")).toHaveLength(3);
    expect(screen.getByTestId("organisation-plans-read-only")).toBeTruthy();
    expect(screen.getByText("Studio Pro")).toBeTruthy();
    expect(screen.queryByText("Buy")).toBeNull();
    expect(screen.queryByText("Start trial")).toBeNull();
    expect(screen.queryByText("Talk to us")).toBeNull();
  });

  it("shows the unavailable comparison notice and restores purchases", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} isUnavailable isRestoring />);
    expect(screen.getByTestId("ios-purchase-unavailable")).toBeTruthy();
    expect(screen.getByText("Restoring...")).toBeTruthy();
  });

  it("renders a current plan management state", () => {
    const props = defaultProps();
    render(
      <IOSPurchaseFlowPresenter
        {...props}
        screen="manage"
        currentTier="premium_plus"
        currentTierDisplayName="Premium+"
        subscriptionEndsAt="2027-03-14T00:00:00.000Z"
      />,
    );
    expect(screen.getByTestId("subscription-manage-screen")).toBeTruthy();
    expect(screen.getByText("£249.99")).toBeTruthy();
    expect(screen.getByText(/renews 14 Mar 2027/i)).toBeTruthy();
    fireEvent.press(screen.getByTestId("subscription-change-plan"));
    fireEvent.press(screen.getByTestId("ios-purchase-manage"));
    expect(props.onChangePlan).toHaveBeenCalled();
    expect(props.onManageInAppStore).toHaveBeenCalled();
  });

  it("renders cancelled manage state and a catalog-missing grant safely", () => {
    const props = defaultProps();
    render(
      <IOSPurchaseFlowPresenter
        {...props}
        screen="manage"
        currentTier="premium"
        currentTierDisplayName="Promotional access"
        isCancelledButActive
      />,
    );
    expect(screen.getByText("CANCELLED")).toBeTruthy();
  });

  it("routes the header back affordance", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} />);
    fireEvent.press(screen.getByTestId("ios-purchase-back"));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("Price supports invoiced, monthly and provisional catalog values", () => {
    const tier = catalogTier("premium");
    const view = render(<Price tier={tier} cadence="monthly" />);
    expect(screen.getByText("£16.99")).toBeTruthy();

    view.rerender(<Price tier={catalogTier("enterprise")} cadence="monthly" />);
    expect(screen.getByText("Invoiced")).toBeTruthy();

    view.rerender(
      <Price
        tier={{ ...tier, annual: 199.99, provisionalAnnual: true }}
        cadence="annual"
      />,
    );
    expect(screen.getByText("£199.99*")).toBeTruthy();
  });
});
