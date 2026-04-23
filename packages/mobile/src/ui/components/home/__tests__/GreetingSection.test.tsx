import { fireEvent } from "@testing-library/react-native";
import { GreetingSection } from "@/ui/components/home/GreetingSection";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("GreetingSection", () => {
  const base = {
    userName: "Alex",
    subscriptionTier: "free",
    isFreeTier: true,
    onUpgradePress: jest.fn(),
    onManageSubscription: jest.fn(),
  };

  it("renders the user name + a time-based greeting", () => {
    const { getByText } = renderWithTheme(<GreetingSection {...base} />);
    expect(getByText("Alex")).toBeTruthy();
    expect(getByText(/Good (morning|afternoon|evening)/)).toBeTruthy();
  });

  it("shows Free Tier + Upgrade CTA when isFreeTier is true", () => {
    const onUpgradePress = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <GreetingSection {...base} onUpgradePress={onUpgradePress} />,
    );
    expect(getByText("Free Tier")).toBeTruthy();
    fireEvent.press(getByTestId("subscription-upgrade"));
    expect(onUpgradePress).toHaveBeenCalled();
  });

  it("shows tier name + Manage CTA for paid tiers", () => {
    const onManageSubscription = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <GreetingSection
        {...base}
        subscriptionTier="premium"
        isFreeTier={false}
        onManageSubscription={onManageSubscription}
      />,
    );
    expect(getByText("Premium User")).toBeTruthy();
    fireEvent.press(getByTestId("subscription-manage"));
    expect(onManageSubscription).toHaveBeenCalled();
  });

  it("falls back to 'Free User' for unknown tier", () => {
    const { getByText } = renderWithTheme(
      <GreetingSection
        {...base}
        subscriptionTier="unknown"
        isFreeTier={false}
      />,
    );
    expect(getByText("Free User")).toBeTruthy();
  });
});
