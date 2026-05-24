import { fireEvent, render, screen } from "@testing-library/react-native";
import type { FeatureGatePromptProps } from "@/ui/components/subscription/FeatureGatePrompt";
import { MyProgressLockedSection } from "../MyProgressLockedSection";

function makeGateProps(
  overrides: Partial<FeatureGatePromptProps> = {},
): FeatureGatePromptProps {
  return {
    feature: "gym_buddy",
    featureDisplayName: "Gym Buddy access",
    currentTier: "free",
    upgradeTo: "basic",
    upgradePriceMonthly: 4.99,
    onUpgrade: jest.fn(),
    ...overrides,
  };
}

describe("MyProgressLockedSection", () => {
  it("renders the section header + view-all tap target", () => {
    render(
      <MyProgressLockedSection
        workoutsThisMonth={5}
        workoutsLastMonth={7}
        gateProps={makeGateProps()}
        onViewAllPress={jest.fn()}
      />,
    );
    expect(screen.getByTestId("my-progress-section-locked")).toBeTruthy();
    expect(screen.getByTestId("my-progress-view-all")).toBeTruthy();
    expect(screen.getByText("My Progress")).toBeTruthy();
  });

  it("renders the FeatureGatePrompt with the supplied gate props", () => {
    render(
      <MyProgressLockedSection
        workoutsThisMonth={5}
        workoutsLastMonth={7}
        gateProps={makeGateProps()}
        onViewAllPress={jest.fn()}
      />,
    );
    expect(screen.getByTestId("feature-gate-prompt-gym_buddy")).toBeTruthy();
    expect(screen.getByText("Upgrade to Basic")).toBeTruthy();
  });

  it("fires onViewAllPress when the view-all target is tapped", () => {
    const onViewAllPress = jest.fn();
    render(
      <MyProgressLockedSection
        workoutsThisMonth={5}
        workoutsLastMonth={7}
        gateProps={makeGateProps()}
        onViewAllPress={onViewAllPress}
      />,
    );
    fireEvent.press(screen.getByTestId("my-progress-view-all"));
    expect(onViewAllPress).toHaveBeenCalledTimes(1);
  });

  it("forwards the gate's onUpgrade through the FeatureGatePrompt", () => {
    const onUpgrade = jest.fn();
    render(
      <MyProgressLockedSection
        workoutsThisMonth={5}
        workoutsLastMonth={7}
        gateProps={makeGateProps({ onUpgrade })}
        onViewAllPress={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByTestId("feature-gate-upgrade"));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});
