import { fireEvent, render, screen } from "@testing-library/react-native";
import type { SubscriptionTier } from "@/domain/models/subscription";
import { TrainerSubscriptionCard } from "@/ui/components/subscription/TrainerSubscriptionCard";

const STD: SubscriptionTier = {
  tierName: "small_business_standard",
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
  tierName: "small_business_pro",
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
      tierName: "individual_trainer_standard" as const,
    };
    const trainerPro = { ...PRO, tierName: "individual_trainer_pro" as const };
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
    const medStd = { ...STD, tierName: "medium_enterprise_standard" as const };
    const medPro = { ...PRO, tierName: "medium_enterprise_pro" as const };
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
    fireEvent.press(
      screen.getByTestId("trainer-card-small_business_standard-standard"),
    );
    fireEvent.press(
      screen.getByTestId("trainer-card-small_business_standard-pro"),
    );
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

  it("treats null priceYearly as 0 in the yearly column", () => {
    const stdNoYearly = { ...STD, priceYearly: null };
    render(
      <TrainerSubscriptionCard
        standardTier={stdNoYearly}
        proTier={PRO}
        billingCycle="yearly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    // With priceYearly null → 0; savings = 49*12 - 0 = 588 > 0 → both strikethrough + £0/year
    expect(screen.getByText("£0/year")).toBeTruthy();
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
});
