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
    expect(getByText("Premium")).toBeTruthy();
    fireEvent.press(getByTestId("subscription-manage"));
    expect(onManageSubscription).toHaveBeenCalled();
  });

  it("falls back to 'Free' for unknown tier", () => {
    const { getByText } = renderWithTheme(
      <GreetingSection
        {...base}
        subscriptionTier="unknown"
        isFreeTier={false}
      />,
    );
    expect(getByText("Free")).toBeTruthy();
  });

  describe("time-of-day greeting", () => {
    let hourSpy: jest.SpyInstance<number, []>;
    afterEach(() => {
      hourSpy?.mockRestore();
    });

    function mockHour(hour: number) {
      // Stub Date.prototype.getHours so getTimeBasedGreeting falls
      // into each branch deterministically. Less invasive than
      // replacing the whole Date constructor.
      hourSpy = jest.spyOn(Date.prototype, "getHours").mockReturnValue(hour);
    }

    it("renders 'Good morning' before noon", () => {
      mockHour(9);
      const { getByText } = renderWithTheme(<GreetingSection {...base} />);
      expect(getByText("Good morning")).toBeTruthy();
    });

    it("renders 'Good afternoon' between noon and 5pm", () => {
      mockHour(14);
      const { getByText } = renderWithTheme(<GreetingSection {...base} />);
      expect(getByText("Good afternoon")).toBeTruthy();
    });

    it("renders 'Good evening' at or after 5pm", () => {
      mockHour(19);
      const { getByText } = renderWithTheme(<GreetingSection {...base} />);
      expect(getByText("Good evening")).toBeTruthy();
    });
  });

  it("hides the Manage CTA for paid users when onManageSubscription is omitted", () => {
    const { queryByTestId } = renderWithTheme(
      <GreetingSection
        userName="Alex"
        subscriptionTier="premium"
        isFreeTier={false}
        onUpgradePress={undefined as unknown as () => void}
        onManageSubscription={undefined as unknown as () => void}
      />,
    );
    expect(queryByTestId("subscription-manage")).toBeNull();
    expect(queryByTestId("subscription-upgrade")).toBeNull();
  });
});
