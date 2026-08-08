import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import {
  IOSPurchaseFlowPresenter,
  Price,
  type IOSPurchaseFlowPresenterProps,
} from "@/ui/presenters/IOSPurchaseFlowPresenter";
import { catalogTier } from "@persistence/subscription-catalog";

function defaultProps(): IOSPurchaseFlowPresenterProps {
  return {
    tierPricing: {
      free: { monthly: 0, annual: null },
      premium: { monthly: 16.99, annual: 139.99 },
      premium_plus: { monthly: 29.99, annual: 249.99 },
      individual_trainer: { monthly: 18.99, annual: 159.99 },
      start_up_coach_plus: { monthly: 34.99, annual: 289.99 },
      coach: { monthly: 59.99, annual: 499.99 },
      coach_pro: { monthly: 99.99, annual: 839.99 },
    },
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

  it("activates only tiers backed by a live App Store package", () => {
    const props = defaultProps();
    render(
      <IOSPurchaseFlowPresenter
        {...props}
        purchasableTiers={new Set(["premium"])}
      />,
    );

    fireEvent.press(screen.getByTestId("subscription-card-premium-subscribe"));
    expect(props.onTierSelect).toHaveBeenCalledWith("premium");
    expect(
      screen.getByTestId("subscription-card-premium_plus-coming-soon"),
    ).toBeTruthy();
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

  it("renders the coach ladder without organisation plans or web purchase messaging", () => {
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
    expect(screen.queryByText("Studio")).toBeNull();
    expect(screen.queryByText("Studio Pro")).toBeNull();
    expect(screen.queryByText("Enterprise")).toBeNull();
    expect(screen.queryByText(/organisation/i)).toBeNull();
    expect(screen.queryByText(/web only/i)).toBeNull();
    expect(screen.queryByText(/on the web/i)).toBeNull();
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
    expect(screen.getAllByText("Annual")).toHaveLength(2);
    expect(screen.getByText(/renews 14 Mar 2027/i)).toBeTruthy();
    expect(screen.queryByText(/organisation/i)).toBeNull();
    expect(screen.queryByText(/on the web/i)).toBeNull();
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
        subscriptionEndsAt="2027-03-14T00:00:00.000Z"
      />,
    );
    expect(screen.getByText("CANCELLED")).toBeTruthy();
    expect(screen.getByText(/ends 14 Mar 2027/i)).toBeTruthy();
    expect(screen.queryByText(/renews 14 Mar 2027/i)).toBeNull();
  });

  it("routes the header back affordance", () => {
    const props = defaultProps();
    render(<IOSPurchaseFlowPresenter {...props} />);
    fireEvent.press(screen.getByTestId("ios-purchase-back"));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("Price supports live, localised and provisional values", () => {
    const tier = catalogTier("premium");
    const view = render(
      <Price
        tier={tier}
        pricing={{ monthly: 17.49, annual: 144.99, monthlyLabel: "£17.49" }}
        cadence="monthly"
      />,
    );
    expect(screen.getByText("£17.49")).toBeTruthy();

    view.rerender(
      <Price
        tier={{ ...tier, provisionalAnnual: true }}
        pricing={{ monthly: 19.99, annual: 199.99 }}
        cadence="annual"
      />,
    );
    expect(screen.getByText("£199.99*")).toBeTruthy();

    view.rerender(
      <Price
        tier={{ ...tier, provisionalAnnual: true }}
        pricing={{ monthly: 19.99, annual: 199.99 }}
        cadence="annual"
        monthlyEquivalentOnly
      />,
    );
    expect(screen.getByText("£16.67*")).toBeTruthy();

    view.rerender(
      <Price
        tier={tier}
        pricing={{
          monthly: 24.99,
          annual: 209.99,
          annualLabel: "US$209.99",
          annualMonthlyEquivalentLabel: "US$17.50",
        }}
        cadence="annual"
        monthlyEquivalentOnly
      />,
    );
    expect(screen.getByText("US$17.50")).toBeTruthy();
    expect(screen.queryByText("£17.50")).toBeNull();
  });
});
