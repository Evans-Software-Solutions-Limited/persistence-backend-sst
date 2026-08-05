import { fireEvent, render, screen } from "@testing-library/react-native";
import type { SubscriptionTier } from "@/domain/models/subscription";
import { TrainerSubscriptionCard } from "@/ui/components/subscription/TrainerSubscriptionCard";

const STD: SubscriptionTier = {
  tierName: "coach",
  displayName: "Coach",
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
  tierName: "coach",
  displayName: "Coach",
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

  it("never advertises analytics — the feature does not exist", () => {
    // The live coach paywall bullet. Nothing in the app or backend gates an
    // analytics screen, and this card is what a coach actually sees — the
    // getFeaturesList isTrainer branch that also carried the claim is
    // unreachable, so THIS is the regression guard that matters.
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
    expect(screen.queryByText(/analytics/i)).toBeNull();
    expect(screen.queryByText(/reporting & analytics/i)).toBeNull();
  });

  it("derives display name from tier name family — coach", () => {
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
    expect(screen.getByText("Coach")).toBeTruthy();
  });

  it("derives display name for individual_trainer family as 'Start Up Coach'", () => {
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
    expect(screen.getByText("Start Up Coach")).toBeTruthy();
  });

  // Spec-29 Phase 2 (2026-08-05): every coach product contains the substring
  // "coach", so start_up_coach_plus and coach_pro must resolve to their OWN
  // display names, not fall through to the plain "Coach" match.
  it("derives display name for start_up_coach_plus family as 'Start Up Coach +'", () => {
    const plusStd = { ...STD, tierName: "start_up_coach_plus" as const };
    const plusPro = { ...PRO, tierName: "start_up_coach_plus" as const };
    render(
      <TrainerSubscriptionCard
        standardTier={plusStd}
        proTier={plusPro}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("Start Up Coach +")).toBeTruthy();
  });

  it("derives display name for coach_pro family as 'Coach Pro'", () => {
    const proStd = { ...STD, tierName: "coach_pro" as const };
    const proPro = { ...PRO, tierName: "coach_pro" as const };
    render(
      <TrainerSubscriptionCard
        standardTier={proStd}
        proTier={proPro}
        billingCycle="monthly"
        isStandardCurrent={false}
        isProCurrent={false}
        onStandardPress={jest.fn()}
        onProPress={jest.fn()}
      />,
    );
    expect(screen.getByText("Coach Pro")).toBeTruthy();
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
    expect(screen.getByText("Free trial")).toBeTruthy();
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
    fireEvent.press(screen.getByTestId("trainer-card-coach-standard"));
    fireEvent.press(screen.getByTestId("trainer-card-coach-pro"));
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
    expect(screen.getByText("Coach")).toBeTruthy();
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
    expect(screen.getByText("Coach")).toBeTruthy();
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
    fireEvent.press(screen.getByTestId("trainer-card-coach-standard"));
    expect(onStandardPress).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId("trainer-card-coach-pro"));
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
});
