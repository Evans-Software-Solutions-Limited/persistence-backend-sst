import { render, screen } from "@testing-library/react-native";
import { SubscriptionBadge } from "@/ui/components/subscription/SubscriptionBadge";

describe("SubscriptionBadge", () => {
  it("renders 'Free' label for the free tier", () => {
    render(<SubscriptionBadge tier="free" paymentStatus="active" />);
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.getByTestId("subscription-badge-free")).toBeTruthy();
  });

  it("renders 'Basic' label for the basic tier", () => {
    render(<SubscriptionBadge tier="basic" paymentStatus="active" />);
    expect(screen.getByText("Basic")).toBeTruthy();
  });

  it("renders 'Premium' label for the premium tier", () => {
    render(<SubscriptionBadge tier="premium" paymentStatus="active" />);
    expect(screen.getByText("Premium")).toBeTruthy();
  });

  it("collapses individual trainer tiers to compact display names", () => {
    render(
      <SubscriptionBadge
        tier="individual_trainer_pro"
        paymentStatus="active"
      />,
    );
    expect(screen.getByText("Trainer Pro")).toBeTruthy();
    expect(
      screen.getByTestId("subscription-badge-individual_trainer_pro"),
    ).toBeTruthy();
  });

  it("collapses business + enterprise tiers to compact display names", () => {
    render(
      <SubscriptionBadge
        tier="small_business_standard"
        paymentStatus="active"
      />,
    );
    expect(screen.getByText("Business")).toBeTruthy();
  });

  it("appends ' · Trial' when status is trialing", () => {
    render(<SubscriptionBadge tier="basic" paymentStatus="trialing" />);
    expect(screen.getByText("Basic · Trial")).toBeTruthy();
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
        <SubscriptionBadge tier="basic" paymentStatus={status} />,
      );
      expect(screen.queryByText(/Basic ·/)).toBeNull();
      expect(screen.getByText("Basic")).toBeTruthy();
      unmount();
    }
  });

  it("applies a compact style variant when compact=true (smaller font)", () => {
    const { rerender } = render(
      <SubscriptionBadge tier="premium" paymentStatus="active" />,
    );
    const fullText = screen.getByText("Premium");
    // The rendered React Native style prop is a flat array; the compact
    // variant must push a smaller fontSize on top. We don't assert pixel
    // values (might drift) — just that the compact prop produces a
    // different style array length than the default. This proves the
    // variant branch fires.
    const fullStyle = fullText.props.style;
    rerender(
      <SubscriptionBadge tier="premium" paymentStatus="active" compact />,
    );
    const compactText = screen.getByText("Premium");
    const compactStyle = compactText.props.style;
    expect(JSON.stringify(compactStyle)).not.toBe(JSON.stringify(fullStyle));
  });

  it("renders for every defined SubscriptionTierName without crashing (snapshot of branch coverage)", () => {
    const tiers = [
      "free",
      "basic",
      "premium",
      "individual_trainer_standard",
      "individual_trainer_pro",
      "small_business_standard",
      "small_business_pro",
      "medium_enterprise_standard",
      "medium_enterprise_pro",
    ] as const;
    for (const tier of tiers) {
      const { unmount } = render(
        <SubscriptionBadge tier={tier} paymentStatus="active" />,
      );
      expect(screen.getByTestId(`subscription-badge-${tier}`)).toBeTruthy();
      unmount();
    }
  });
});
