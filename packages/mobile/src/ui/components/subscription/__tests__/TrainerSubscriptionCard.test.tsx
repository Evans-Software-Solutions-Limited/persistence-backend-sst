import { fireEvent, render, screen } from "@testing-library/react-native";
import type { SubscriptionTier } from "@/domain/models/subscription";
import { TrainerSubscriptionCard } from "@/ui/components/subscription/TrainerSubscriptionCard";

const STD: SubscriptionTier = {
  tierName: "small_business",
  displayName: "Small Business (Standard)",
  description: null,
  priceMonthly: 49,
  priceYearly: 490,
  currency: "GBP",
  features: {},
  workoutLimit: null,
  aiAccess: false,
  aiWorkoutLimit: 0,
  gymBuddyAccess: false,
  trainerClientLimit: 25,
  isTrainerTier: true,
  analyticsAccess: true,
  exportAccess: true,
  stripePriceIdMonthly: "price_std_m",
  stripePriceIdYearly: "price_std_y",
};

const PRO: SubscriptionTier = {
  ...STD,
  tierName: "small_business",
  displayName: "Small Business (Pro)",
  priceMonthly: 99,
  priceYearly: 990,
  aiAccess: true,
};

describe("TrainerSubscriptionCard", () => {
  it("renders nothing when both tiers are null", () => {
    const { toJSON } = render(
      <TrainerSubscriptionCard
        standardTier={null}
        proTier={null}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it("derives display name from tier name family — small_business", () => {
    render(
      <TrainerSubscriptionCard
        standardTier={STD}
        proTier={PRO}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("Small Business")).toBeTruthy();
  });

  it("derives display name for individual_trainer family", () => {
    const trainerStd = {
      ...STD,
      tierName: "individual_trainer" as const,
    };
    const trainerPro = { ...PRO, tierName: "individual_trainer" as const };
    render(
      <TrainerSubscriptionCard
        standardTier={trainerStd}
        proTier={trainerPro}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("Individual Trainer")).toBeTruthy();
  });

  it("derives display name for medium_enterprise as 'Medium to Enterprise'", () => {
    const medStd = { ...STD, tierName: "medium_enterprise" as const };
    const medPro = { ...PRO, tierName: "medium_enterprise" as const };
    render(
      <TrainerSubscriptionCard
        standardTier={medStd}
        proTier={medPro}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("Medium to Enterprise")).toBeTruthy();
  });

  it("renders client slot count from the standard tier when present", () => {
    render(
      <TrainerSubscriptionCard
        standardTier={STD}
        proTier={PRO}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("25 client slots")).toBeTruthy();
  });

  it("renders prices for both columns at monthly cadence", () => {
    render(
      <TrainerSubscriptionCard
        standardTier={STD}
        proTier={PRO}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("£49/month")).toBeTruthy();
    expect(screen.getByText("£99/month")).toBeTruthy();
  });

  it("renders Pro trial banner when showProTrialBanner is true", () => {
    render(
      <TrainerSubscriptionCard
        standardTier={STD}
        proTier={PRO}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        showProTrialBanner
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("14-day free trial")).toBeTruthy();
  });

  it("uses custom trialBannerText when provided", () => {
    render(
      <TrainerSubscriptionCard
        standardTier={STD}
        proTier={PRO}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        showProTrialBanner
        trialBannerText="30-day free trial"
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("30-day free trial")).toBeTruthy();
  });

  it("fires onStandardPress / onProPress for the respective columns", () => {
    const onStd = jest.fn();
    const onPro = jest.fn();
    render(
      <TrainerSubscriptionCard
        standardTier={STD}
        proTier={PRO}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={onStd}
        onProPress={onPro}
      />,
    );
    fireEvent.press(screen.getByTestId("trainer-card-small_business-standard"));
    fireEvent.press(screen.getByTestId("trainer-card-small_business-pro"));
    expect(onStd).toHaveBeenCalledTimes(1);
    expect(onPro).toHaveBeenCalledTimes(1);
  });

  it("renders the Current Plan badge when either tier is current", () => {
    render(
      <TrainerSubscriptionCard
        standardTier={STD}
        proTier={PRO}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("Current Plan")).toBeTruthy();
  });

  it("renders with only standardTier (proTier null) and falls back display name correctly", () => {
    render(
      <TrainerSubscriptionCard
        standardTier={STD}
        proTier={null}
        billingCycle="monthly"
        isStandardCurrent
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("Small Business")).toBeTruthy();
    expect(screen.getByText("£49/month")).toBeTruthy();
    expect(screen.queryByTestId(/-pro$/)).toBeNull();
  });

  it("renders with only proTier (standardTier null) and reads client slots from pro", () => {
    render(
      <TrainerSubscriptionCard
        standardTier={null}
        proTier={PRO}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("Small Business")).toBeTruthy();
    expect(screen.getByText("£99/month")).toBeTruthy();
    expect(screen.queryByTestId(/-standard$/)).toBeNull();
  });

  it("uses 0 client slots when neither tier sets trainerClientLimit", () => {
    const stdNoSlots = { ...STD, trainerClientLimit: null };
    const proNoSlots = { ...PRO, trainerClientLimit: null };
    render(
      <TrainerSubscriptionCard
        standardTier={stdNoSlots}
        proTier={proNoSlots}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("0 client slots")).toBeTruthy();
  });

  it("renders 'Yearly not available' + disables tap when a column has no priceYearly on yearly cycle (Inspector Brad PR #71 medium-severity find — sweep #1)", () => {
    // Regression: previously the column fell back to £0/year + showed
    // a red strikethrough of monthly*12, making the tier look free
    // and letting the user tap into an Apple Pay sheet for £0 — the
    // backend then errored after the biometric tap.
    const onStandardPress = jest.fn();
    const onProPress = jest.fn();
    const stdNoYearly: SubscriptionTier = {
      ...STD,
      priceYearly: null,
      stripePriceIdYearly: null,
    };
    render(
      <TrainerSubscriptionCard
        standardTier={stdNoYearly}
        proTier={PRO}
        billingCycle="yearly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={onStandardPress}
        onProPress={onProPress}
      />,
    );
    // Standard column communicates the unavailable state — no £0/year,
    // no monthly*12 strikethrough.
    expect(screen.getAllByText("Yearly not available").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("£0/year")).toBeNull();
    expect(screen.queryByText("£588/year")).toBeNull();
    // Pro column unaffected — has its own yearly price.
    expect(screen.getByText("£990/year")).toBeTruthy();
    // Both columns stay tappable — the container alerts on the
    // unavailable column rather than silently swallowing taps.
    fireEvent.press(screen.getByTestId("trainer-card-small_business-standard"));
    expect(onStandardPress).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId("trainer-card-small_business-pro"));
    expect(onProPress).toHaveBeenCalledTimes(1);
  });

  it("shows the yearly strikethrough only on the columns where savings exist", () => {
    render(
      <TrainerSubscriptionCard
        standardTier={STD}
        proTier={PRO}
        billingCycle="yearly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("£588/year")).toBeTruthy(); // 49 * 12
    expect(screen.getByText("£1188/year")).toBeTruthy(); // 99 * 12
    expect(screen.getByText("£490/year")).toBeTruthy();
    expect(screen.getByText("£990/year")).toBeTruthy();
  });

  it("contactSalesMode: shows Contact Sales (no price) and fires onContactSales instead of onProPress", () => {
    const onContactSales = jest.fn();
    const onProPress = jest.fn();
    render(
      <TrainerSubscriptionCard
        standardTier={null}
        proTier={PRO}
        billingCycle="yearly"
        isStandardCurrent={false}
        isProCurrent={false}
        showProTrialBanner
        contactSalesMode
        onContactSales={onContactSales}
        onStandardPress={jest.fn()}
        onProPress={onProPress}
      />,
    );
    expect(screen.getByText("Contact Sales")).toBeTruthy();
    // No trial banner in contact-sales mode.
    expect(screen.queryByText(/free trial/i)).toBeNull();
    fireEvent.press(screen.getByTestId("trainer-card-small_business-pro"));
    expect(onContactSales).toHaveBeenCalledTimes(1);
    expect(onProPress).not.toHaveBeenCalled();
  });
});
