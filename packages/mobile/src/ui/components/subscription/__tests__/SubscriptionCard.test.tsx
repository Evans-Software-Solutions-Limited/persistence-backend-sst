import { fireEvent, render, screen } from "@testing-library/react-native";
import type { SubscriptionTier } from "@/domain/models/subscription";
import { SubscriptionCard } from "@/ui/components/subscription/SubscriptionCard";

const PREMIUM: SubscriptionTier = {
  tierName: "premium",
  displayName: "Premium",
  description: null,
  priceMonthly: 14.99,
  priceYearly: 149.99,
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
  stripePriceIdMonthly: "price_premium_m",
  stripePriceIdYearly: "price_premium_y",
};

const TRAINER_PRO: SubscriptionTier = {
  ...PREMIUM,
  tierName: "individual_trainer_pro",
  displayName: "Individual Trainer (Pro)",
  isTrainerTier: true,
  trainerClientLimit: 10,
};

describe("SubscriptionCard", () => {
  it("renders the display name and monthly price", () => {
    render(
      <SubscriptionCard
        tier={PREMIUM}
        billingCycle="monthly"
        isCurrent={false}
        onPress={jest.fn()}
        getFeaturesList={() => ["Unlimited workouts", "6 AI workouts"]}
      />,
    );
    expect(screen.getByText("Premium")).toBeTruthy();
    expect(screen.getByText("£14.99/month")).toBeTruthy();
  });

  it("shows the strikethrough yearly comparison when savings exist", () => {
    render(
      <SubscriptionCard
        tier={PREMIUM}
        billingCycle="yearly"
        isCurrent={false}
        onPress={jest.fn()}
        getFeaturesList={() => []}
      />,
    );
    // monthlyPrice * 12 = 179.88; yearly = 149.99 → savings > 0
    expect(screen.getByText("£179.88/year")).toBeTruthy();
    expect(screen.getByText("£149.99/year")).toBeTruthy();
  });

  it("renders Current Plan badge when isCurrent is true", () => {
    render(
      <SubscriptionCard
        tier={PREMIUM}
        billingCycle="monthly"
        isCurrent
        onPress={jest.fn()}
        getFeaturesList={() => []}
      />,
    );
    expect(screen.getByText("Current Plan")).toBeTruthy();
  });

  it("renders trial banner with provided text when shown", () => {
    render(
      <SubscriptionCard
        tier={PREMIUM}
        billingCycle="monthly"
        isCurrent={false}
        showTrialBanner
        trialBannerText="7-day free trial"
        onPress={jest.fn()}
        getFeaturesList={() => []}
      />,
    );
    expect(screen.getByText("7-day free trial")).toBeTruthy();
  });

  it("uses 'Free trial' as default banner text", () => {
    render(
      <SubscriptionCard
        tier={PREMIUM}
        billingCycle="monthly"
        isCurrent={false}
        showTrialBanner
        onPress={jest.fn()}
        getFeaturesList={() => []}
      />,
    );
    expect(screen.getByText("Free trial")).toBeTruthy();
  });

  it("renders trainer client slots when isTrainer + trainerClientLimit set", () => {
    render(
      <SubscriptionCard
        tier={TRAINER_PRO}
        billingCycle="monthly"
        isCurrent={false}
        isTrainer
        onPress={jest.fn()}
        getFeaturesList={() => []}
      />,
    );
    expect(screen.getByText("10 client slots")).toBeTruthy();
  });

  it("renders the feature list returned by getFeaturesList", () => {
    render(
      <SubscriptionCard
        tier={PREMIUM}
        billingCycle="monthly"
        isCurrent={false}
        onPress={jest.fn()}
        getFeaturesList={() => ["A", "B", "C"]}
      />,
    );
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.getByText("C")).toBeTruthy();
  });

  it("does not render the features section when getFeaturesList returns []", () => {
    render(
      <SubscriptionCard
        tier={PREMIUM}
        billingCycle="monthly"
        isCurrent={false}
        onPress={jest.fn()}
        getFeaturesList={() => []}
      />,
    );
    expect(screen.queryByText("What's included:")).toBeNull();
  });

  it("fires onPress when the subscribe button is tapped", () => {
    const onPress = jest.fn();
    render(
      <SubscriptionCard
        tier={PREMIUM}
        billingCycle="monthly"
        isCurrent={false}
        onPress={onPress}
        getFeaturesList={() => []}
      />,
    );
    fireEvent.press(screen.getByTestId("subscription-card-premium-subscribe"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("renders 'Yearly not available' + disables Subscribe when on yearly cycle with no priceYearly (Inspector Brad PR #71 medium-severity find — sweep #1)", () => {
    const onPress = jest.fn();
    const NO_YEARLY: SubscriptionTier = {
      ...PREMIUM,
      priceYearly: null,
      stripePriceIdYearly: null,
    };
    render(
      <SubscriptionCard
        tier={NO_YEARLY}
        billingCycle="yearly"
        isCurrent={false}
        onPress={onPress}
        getFeaturesList={() => []}
      />,
    );
    // Both the price slot AND the button label communicate the
    // unavailable state — no £0/year, no red strikethrough.
    expect(screen.getAllByText("Yearly not available").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("£0/year")).toBeNull();
    expect(screen.queryByText("£179.88/year")).toBeNull();
    // Button stays tappable — the container responds with an alert
    // explaining the unavailable state. Disabling at the card level
    // would silently swallow taps, which is worse UX than an
    // explanatory alert.
    fireEvent.press(screen.getByTestId("subscription-card-premium-subscribe"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
