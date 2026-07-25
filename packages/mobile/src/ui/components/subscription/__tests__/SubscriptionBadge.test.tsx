import { render, screen } from "@testing-library/react-native";
import { SubscriptionBadge } from "@/ui/components/subscription/SubscriptionBadge";

describe("SubscriptionBadge", () => {
  it("renders 'Free' label for the free tier", () => {
    render(<SubscriptionBadge tier="free" paymentStatus="active" />);
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.getByTestId("subscription-badge-free")).toBeTruthy();
  });

  it("renders 'Premium' label for the premium tier", () => {
    render(<SubscriptionBadge tier="premium" paymentStatus="active" />);
    expect(screen.getByText("Premium")).toBeTruthy();
  });

  it("collapses individual trainer tier to 'Trainer' compact display name", () => {
    render(
      <SubscriptionBadge tier="individual_trainer" paymentStatus="active" />,
    );
    expect(screen.getByText("Trainer")).toBeTruthy();
    expect(
      screen.getByTestId("subscription-badge-individual_trainer"),
    ).toBeTruthy();
  });

  it("collapses small_business to 'Business Trainer' display name", () => {
    render(<SubscriptionBadge tier="small_business" paymentStatus="active" />);
    expect(screen.getByText("Business Trainer")).toBeTruthy();
  });

  it("collapses medium_enterprise to 'Enterprise Trainer' display name", () => {
    render(
      <SubscriptionBadge tier="medium_enterprise" paymentStatus="active" />,
    );
    expect(screen.getByText("Enterprise Trainer")).toBeTruthy();
  });

  it("appends ' · Trial' when status is trialing", () => {
    render(<SubscriptionBadge tier="premium" paymentStatus="trialing" />);
    expect(screen.getByText("Premium · Trial")).toBeTruthy();
  });

  it("appends ' · Cancelled' when status is cancelled", () => {
    render(<SubscriptionBadge tier="premium" paymentStatus="cancelled" />);
    expect(screen.getByText("Premium · Cancelled")).toBeTruthy();
  });

  it("omits the status suffix for active / past_due / incomplete / unpaid", () => {
    for (const status of [
      "active",
      "past_due",
      "incomplete",
      "incomplete_expired",
      "unpaid",
    ] as const) {
      const { unmount } = render(
        <SubscriptionBadge tier="premium" paymentStatus={status} />,
      );
      expect(screen.queryByText(/Premium ·/)).toBeNull();
      expect(screen.getByText("Premium")).toBeTruthy();
      unmount();
    }
  });

  it("applies a compact style variant when compact=true (smaller font)", () => {
    const { rerender } = render(
      <SubscriptionBadge tier="premium" paymentStatus="active" />,
    );
    const fullText = screen.getByText("Premium");
    const fullStyle = fullText.props.style;
    rerender(
      <SubscriptionBadge tier="premium" paymentStatus="active" compact />,
    );
    const compactText = screen.getByText("Premium");
    const compactStyle = compactText.props.style;
    expect(JSON.stringify(compactStyle)).not.toBe(JSON.stringify(fullStyle));
  });

  it("renders for every defined SubscriptionTierName without crashing (branch coverage)", () => {
    const tiers = [
      "free",
      "premium",
      "premium_plus",
      "individual_trainer",
      "small_business",
      "medium_enterprise",
    ] as const;
    for (const tier of tiers) {
      const { unmount } = render(
        <SubscriptionBadge tier={tier} paymentStatus="active" />,
      );
      expect(screen.getByTestId(`subscription-badge-${tier}`)).toBeTruthy();
      unmount();
    }
  });

  it("renders 'Premium+' label for the premium_plus tier (M19-P0)", () => {
    render(<SubscriptionBadge tier="premium_plus" paymentStatus="active" />);
    expect(screen.getByText("Premium+")).toBeTruthy();
    expect(screen.getByTestId("subscription-badge-premium_plus")).toBeTruthy();
  });

  it("shares the premium palette for premium_plus (consumer tier, not trainer) — M19-P0", () => {
    function backgroundColorOf(tier: "premium" | "premium_plus") {
      const { unmount } = render(
        <SubscriptionBadge tier={tier} paymentStatus="active" />,
      );
      const badge = screen.getByTestId(`subscription-badge-${tier}`);
      const style = ([] as unknown[]).concat(badge.props.style) as {
        backgroundColor?: string;
      }[];
      const backgroundColor = style.find(
        (s) => s?.backgroundColor,
      )?.backgroundColor;
      unmount();
      return backgroundColor;
    }

    const premiumBg = backgroundColorOf("premium");
    const premiumPlusBg = backgroundColorOf("premium_plus");
    expect(premiumBg).toBeDefined();
    expect(premiumPlusBg).toBe(premiumBg);
  });
});
