import React from "react";
import { Text } from "react-native";
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
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
      premium: {
        monthly: 16.99,
        annual: 139.99,
        monthlyLabel: "£16.99",
        annualLabel: "£139.99",
        annualMonthlyEquivalentLabel: "£11.67",
      },
      premium_plus: {
        monthly: 29.99,
        annual: 249.99,
        monthlyLabel: "£29.99",
        annualLabel: "£249.99",
        annualMonthlyEquivalentLabel: "£20.83",
      },
      individual_trainer: {
        monthly: 18.99,
        annual: 159.99,
        monthlyLabel: "£18.99",
        annualLabel: "£159.99",
        annualMonthlyEquivalentLabel: "£13.33",
      },
      start_up_coach_plus: {
        monthly: 34.99,
        annual: 289.99,
        monthlyLabel: "£34.99",
        annualLabel: "£289.99",
        annualMonthlyEquivalentLabel: "£24.17",
      },
      coach: {
        monthly: 59.99,
        annual: 499.99,
        monthlyLabel: "£59.99",
        annualLabel: "£499.99",
        annualMonthlyEquivalentLabel: "£41.67",
      },
      coach_pro: {
        monthly: 99.99,
        annual: 839.99,
        monthlyLabel: "£99.99",
        annualLabel: "£839.99",
        annualMonthlyEquivalentLabel: "£70.00",
      },
    },
    isLoading: false,
    errorMessage: null,
    isUnavailable: false,
    billingCycle: "yearly",
    currentBillingCycle: null,
    currentTier: "free",
    selectedRole: "user",
    purchasableTiers: new Set(),
    isTierTrialEligible: () => false,
    isTierIntroOfferEligible: () => true,
    tierTrialDays: () => null,
    tierPayUpFrontOffer: () => null,
    hasTrialEligibilityData: false,
    monthlyOnlyTiers: new Set(),
    subscriptionEndsAt: null,
    isCancelledButActive: false,
    currentTierDisplayName: "Free",
    isProcessing: false,
    processingPhase: null,
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
  it("renders referral entry content beneath the native tier cards", () => {
    render(
      <IOSPurchaseFlowPresenter
        {...defaultProps()}
        referralCodeEntry={<Text testID="native-referral-entry">Referral</Text>}
      />,
    );

    expect(screen.getByTestId("native-referral-entry")).toBeTruthy();
  });

  it("uses the existing live-price plan surface for a locked onboarding recommendation", () => {
    const onToggleOtherPlans = jest.fn();
    const onContinueFree = jest.fn();
    const onSkip = jest.fn();
    render(
      <IOSPurchaseFlowPresenter
        {...defaultProps()}
        onboardingRecommendation={{
          recommendedTier: "premium_plus",
          reasons: ["Mealprint matches your nutrition goal"],
          showOtherPlans: false,
          onToggleOtherPlans,
          onContinueFree,
          onSkip,
        }}
      />,
    );

    expect(screen.getByText("£249.99")).toBeTruthy();
    expect(screen.getByText("RECOMMENDED FOR YOU")).toBeTruthy();
    expect(screen.getByText(/Mealprint matches/)).toBeTruthy();
    expect(screen.queryByTestId("role-toggle-user")).toBeNull();
    expect(screen.queryByTestId("subscription-card-premium")).toBeNull();
    fireEvent.press(screen.getByTestId("onboarding-show-other-plans"));
    fireEvent.press(screen.getByTestId("onboarding-continue-free"));
    fireEvent.press(screen.getByTestId("onboarding-recommendation-skip"));
    expect(onToggleOtherPlans).toHaveBeenCalledTimes(1);
    expect(onContinueFree).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("uses exact onboarding free CTA copy when Free is recommended", () => {
    render(
      <IOSPurchaseFlowPresenter
        {...defaultProps()}
        onboardingRecommendation={{
          recommendedTier: "free",
          reasons: ["Free covers your selected tools"],
          showOtherPlans: false,
          onToggleOtherPlans: jest.fn(),
          onContinueFree: jest.fn(),
          onSkip: jest.fn(),
        }}
      />,
    );
    expect(screen.getByText("Continue with Free")).toBeTruthy();
  });

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

  it("renders a pay-up-front intro price and its renewal note, taking priority over a trial banner", () => {
    const props = defaultProps();
    render(
      <IOSPurchaseFlowPresenter
        {...props}
        hasTrialEligibilityData
        isTierTrialEligible={(tier) => tier === "premium"}
        tierTrialDays={(tier) => (tier === "premium" ? 7 : null)}
        tierPayUpFrontOffer={(tier) =>
          tier === "premium"
            ? { priceString: "£30.00", periodLabel: "6 months" }
            : null
        }
      />,
    );

    expect(screen.getByText("£30.00 for 6 months")).toBeTruthy();
    expect(
      screen.getByText("Renews at the standard price after that."),
    ).toBeTruthy();
    expect(screen.queryByText("7-day free trial")).toBeNull();
  });

  it("renders a pay-up-front offer on a product with NO free trial", () => {
    // The Android case this exists for. `isTierTrialEligible` there is defined
    // as "has a free trial", so gating the banner on it would have hidden a
    // single-payment Play offer — exactly the offer type being rendered.
    const props = defaultProps();
    render(
      <IOSPurchaseFlowPresenter
        {...props}
        hasTrialEligibilityData
        isTierTrialEligible={() => false}
        isTierIntroOfferEligible={() => true}
        tierTrialDays={() => null}
        tierPayUpFrontOffer={(tier) =>
          tier === "premium"
            ? { priceString: "£30.00", periodLabel: "6 months" }
            : null
        }
      />,
    );

    expect(screen.getByText("£30.00 for 6 months")).toBeTruthy();
    expect(
      screen.getByText("Renews at the standard price after that."),
    ).toBeTruthy();
  });

  it("renders no intro price to a customer who has already used an intro offer", () => {
    // RevenueCat's per-product eligibility is the authority on iOS. Showing
    // the banner regardless would advertise a price they cannot have.
    const props = defaultProps();
    render(
      <IOSPurchaseFlowPresenter
        {...props}
        hasTrialEligibilityData
        isTierIntroOfferEligible={() => false}
        tierPayUpFrontOffer={() => ({
          priceString: "£30.00",
          periodLabel: "6 months",
        })}
      />,
    );

    expect(screen.queryByText("£30.00 for 6 months")).toBeNull();
  });

  it("renders no intro banner for the tier the account is already on", () => {
    const props = defaultProps();
    render(
      <IOSPurchaseFlowPresenter
        {...props}
        hasTrialEligibilityData
        currentTier="premium"
        tierPayUpFrontOffer={() => ({
          priceString: "£30.00",
          periodLabel: "6 months",
        })}
      />,
    );

    expect(screen.queryByTestId("intro-offer-banner-premium")).toBeNull();
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
    const freeCard = screen.getByTestId("subscription-card-free");
    expect(within(freeCard).getByText("Free")).toBeTruthy();
    expect(within(freeCard).queryByText("£0")).toBeNull();
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
        currentBillingCycle="yearly"
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

  it("marks the active tier without disabling either sandbox cadence", () => {
    render(
      <IOSPurchaseFlowPresenter
        {...defaultProps()}
        selectedRole="trainer"
        billingCycle="monthly"
        currentTier="start_up_coach_plus"
        purchasableTiers={new Set(["start_up_coach_plus"])}
      />,
    );

    expect(
      screen.getByTestId("subscription-card-start_up_coach_plus-current"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("subscription-card-start_up_coach_plus-subscribe"),
    ).toBeTruthy();
  });

  it("disables only the exact active product when its cadence is reliable", () => {
    render(
      <IOSPurchaseFlowPresenter
        {...defaultProps()}
        selectedRole="trainer"
        billingCycle="monthly"
        currentBillingCycle="monthly"
        currentTier="start_up_coach_plus"
        purchasableTiers={new Set(["start_up_coach_plus"])}
      />,
    );

    expect(screen.getByText("Current plan")).toBeTruthy();
    expect(
      screen.queryByTestId("subscription-card-start_up_coach_plus-subscribe"),
    ).toBeNull();
  });

  it("covers the paywall while the purchased plan is activating", () => {
    render(
      <IOSPurchaseFlowPresenter
        {...defaultProps()}
        isProcessing
        processingPhase="activating"
      />,
    );

    expect(screen.getByTestId("ios-purchase-processing")).toBeTruthy();
    expect(screen.getByText("Activating your plan…")).toBeTruthy();
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
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

  it("renders administrative access as active fixed-term access", () => {
    render(
      <IOSPurchaseFlowPresenter
        {...defaultProps()}
        screen="manage"
        currentTier="premium"
        currentTierDisplayName="Premium"
        isCancelledButActive
        isFoundingAccess
        subscriptionEndsAt="2027-03-03T00:00:00.000Z"
      />,
    );
    expect(screen.getByText("ACTIVE")).toBeTruthy();
    expect(screen.getByText("Granted access")).toBeTruthy();
    expect(screen.getByText(/active until 3 Mar 2027/i)).toBeTruthy();
    expect(screen.getByText("Fixed-term access")).toBeTruthy();
    expect(screen.getByText("No automatic renewal")).toBeTruthy();
    expect(screen.queryByTestId("ios-purchase-manage")).toBeNull();
    expect(screen.queryByText("Billing period")).toBeNull();
    expect(screen.queryByText("CANCELLED")).toBeNull();
  });

  it("stacks long plan details above billing metadata within the card", () => {
    render(
      <IOSPurchaseFlowPresenter
        {...defaultProps()}
        screen="manage"
        currentTier="start_up_coach_plus"
        currentTierDisplayName="Start Up Coach +"
        currentBillingCycle={null}
        subscriptionEndsAt="2026-08-10T00:00:00.000Z"
      />,
    );

    expect(screen.getByText("Start Up Coach +")).toBeTruthy();
    expect(screen.getByText("Current billing period")).toBeTruthy();
    expect(screen.getByText(/renews 10 Aug 2026/i)).toBeTruthy();
    expect(
      screen.getByTestId("subscription-manage-plan-layout").props.style,
    ).not.toHaveProperty("flexDirection", "row");
    expect(
      screen.getByTestId("subscription-manage-billing").props.style,
    ).toEqual(
      expect.objectContaining({
        alignSelf: "stretch",
        alignItems: "flex-end",
      }),
    );
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
        pricing={{
          monthly: 19.99,
          annual: 199.99,
          annualLabel: "£199.99",
        }}
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
    expect(screen.queryByText("£16.67*")).toBeNull();

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
