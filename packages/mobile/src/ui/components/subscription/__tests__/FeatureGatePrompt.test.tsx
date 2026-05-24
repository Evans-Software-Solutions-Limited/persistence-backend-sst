import { fireEvent, render, screen } from "@testing-library/react-native";
import { FeatureGatePrompt } from "@/ui/components/subscription/FeatureGatePrompt";

describe("FeatureGatePrompt", () => {
  it("renders the feature display name, current-tier line, and upgrade-target preview with price", () => {
    render(
      <FeatureGatePrompt
        feature="ai_workout"
        featureDisplayName="AI Workouts"
        currentTier="free"
        upgradeTo="premium"
        upgradePriceMonthly={14.99}
        onUpgrade={jest.fn()}
      />,
    );
    expect(screen.getByText("AI Workouts")).toBeTruthy();
    expect(screen.getByText("Currently on")).toBeTruthy();
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.getByText("Premium")).toBeTruthy();
    expect(screen.getByText("£14.99/month")).toBeTruthy();
    expect(screen.getByText("Upgrade to Premium")).toBeTruthy();
  });

  it("fires onUpgrade when the upgrade CTA is tapped", () => {
    const onUpgrade = jest.fn();
    render(
      <FeatureGatePrompt
        feature="create_workout"
        featureDisplayName="Custom workouts beyond your monthly limit"
        currentTier="basic"
        upgradeTo="premium"
        upgradePriceMonthly={14.99}
        onUpgrade={onUpgrade}
      />,
    );
    fireEvent.press(screen.getByTestId("feature-gate-upgrade"));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it("renders and fires the dismiss CTA when onDismiss is provided", () => {
    const onDismiss = jest.fn();
    render(
      <FeatureGatePrompt
        feature="gym_buddy"
        featureDisplayName="Gym Buddy access"
        currentTier="basic"
        upgradeTo="premium"
        upgradePriceMonthly={14.99}
        onUpgrade={jest.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(screen.getByTestId("feature-gate-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("hides the dismiss CTA when onDismiss is omitted", () => {
    render(
      <FeatureGatePrompt
        feature="gym_buddy"
        featureDisplayName="Gym Buddy access"
        currentTier="free"
        upgradeTo="premium"
        upgradePriceMonthly={14.99}
        onUpgrade={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("feature-gate-dismiss")).toBeNull();
  });

  it("renders Contact support row when upgradeTo is null (no upgrade path)", () => {
    render(
      <FeatureGatePrompt
        feature="trainer_clients"
        featureDisplayName="Trainer client management"
        currentTier="premium"
        upgradeTo={null}
        upgradePriceMonthly={null}
        onUpgrade={jest.fn()}
      />,
    );
    // The upgrade preview must be hidden; the support affordance must
    // render in its place. The primary upgrade CTA must also be hidden —
    // there's no "Upgrade to (null)" wording allowed.
    expect(screen.getByTestId("feature-gate-contact-support")).toBeTruthy();
    expect(screen.queryByTestId("feature-gate-upgrade-preview")).toBeNull();
    expect(screen.queryByTestId("feature-gate-upgrade")).toBeNull();
    expect(screen.getByText(/Contact support/i)).toBeTruthy();
  });

  it("omits the price label when upgradePriceMonthly is null but the upgrade target exists", () => {
    // Edge case: catalog hasn't fully hydrated yet — upgradeTo is known
    // (from the static chain) but price isn't.
    render(
      <FeatureGatePrompt
        feature="create_workout"
        featureDisplayName="Custom workouts"
        currentTier="free"
        upgradeTo="basic"
        upgradePriceMonthly={null}
        onUpgrade={jest.fn()}
      />,
    );
    expect(screen.getByTestId("feature-gate-upgrade-preview")).toBeTruthy();
    expect(screen.queryByText("£null/month")).toBeNull();
    expect(screen.getByText("Upgrade to Basic")).toBeTruthy();
  });

  it("uses a stable testID derived from the feature name so wave 2 callers can target it", () => {
    render(
      <FeatureGatePrompt
        feature="ai_workout"
        featureDisplayName="AI Workouts"
        currentTier="free"
        upgradeTo="basic"
        upgradePriceMonthly={4.99}
        onUpgrade={jest.fn()}
      />,
    );
    expect(screen.getByTestId("feature-gate-prompt-ai_workout")).toBeTruthy();
  });

  it("formats long-form trainer tier labels for display in the header line", () => {
    render(
      <FeatureGatePrompt
        feature="trainer_clients"
        featureDisplayName="Trainer client management"
        currentTier="individual_trainer_pro"
        upgradeTo={null}
        upgradePriceMonthly={null}
        onUpgrade={jest.fn()}
      />,
    );
    expect(screen.getByText("Individual Trainer (Pro)")).toBeTruthy();
  });
});
