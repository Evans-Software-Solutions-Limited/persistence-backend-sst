import { fireEvent } from "@testing-library/react-native";
import { SubscriptionBadge } from "@/ui/components/home/SubscriptionBadge";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("SubscriptionBadge", () => {
  it("renders 'Free' + Upgrade CTA for free-tier users", () => {
    const onUpgrade = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SubscriptionBadge
        tierName={null}
        isFreeTier
        isTrainerTier={false}
        onUpgradePress={onUpgrade}
      />,
    );
    expect(getByTestId("subscription-badge")).toBeTruthy();
    const upgrade = getByTestId("subscription-upgrade");
    fireEvent.press(upgrade);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it("renders 'Pro' + no upgrade CTA for paid tier", () => {
    const onUpgrade = jest.fn();
    const { queryByTestId, getByText } = renderWithTheme(
      <SubscriptionBadge
        tierName="Pro"
        isFreeTier={false}
        isTrainerTier={false}
        onUpgradePress={onUpgrade}
      />,
    );
    expect(getByText("Pro")).toBeTruthy();
    expect(queryByTestId("subscription-upgrade")).toBeNull();
  });

  it("renders 'Trainer' for trainer tier", () => {
    const { getByText } = renderWithTheme(
      <SubscriptionBadge
        tierName="Coach"
        isFreeTier={false}
        isTrainerTier
        onUpgradePress={jest.fn()}
      />,
    );
    expect(getByText("Trainer")).toBeTruthy();
  });

  it("wires onManagePress when provided", () => {
    const onManage = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SubscriptionBadge
        tierName="Pro"
        isFreeTier={false}
        isTrainerTier={false}
        onUpgradePress={jest.fn()}
        onManagePress={onManage}
      />,
    );
    fireEvent.press(getByTestId("subscription-manage"));
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});
