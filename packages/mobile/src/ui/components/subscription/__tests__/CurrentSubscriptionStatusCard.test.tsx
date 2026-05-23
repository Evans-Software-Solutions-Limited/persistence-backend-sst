import { render, screen } from "@testing-library/react-native";
import { CurrentSubscriptionStatusCard } from "@/ui/components/subscription/CurrentSubscriptionStatusCard";

describe("CurrentSubscriptionStatusCard", () => {
  it("renders 'Current: <tier>' for an active sub", () => {
    render(
      <CurrentSubscriptionStatusCard
        currentTierDisplayName="Premium"
        isCancelledButActive={false}
        subscriptionEndsAt={null}
        scheduledChange={null}
      />,
    );
    expect(screen.getByText("Current: Premium")).toBeTruthy();
  });

  it("renders 'Cancelled: <tier>' + ends-at copy when cancelled-but-active", () => {
    render(
      <CurrentSubscriptionStatusCard
        currentTierDisplayName="Premium"
        isCancelledButActive
        subscriptionEndsAt="2026-06-15T00:00:00.000Z"
        scheduledChange={null}
      />,
    );
    expect(screen.getByText("Cancelled: Premium")).toBeTruthy();
    expect(
      screen.getByText(/Your subscription will remain active until/),
    ).toBeTruthy();
    expect(screen.getByText(/reinstate/)).toBeTruthy();
  });

  it("doesn't render the ends-at subtext when subscriptionEndsAt is null", () => {
    render(
      <CurrentSubscriptionStatusCard
        currentTierDisplayName="Premium"
        isCancelledButActive
        subscriptionEndsAt={null}
        scheduledChange={null}
      />,
    );
    expect(screen.queryByText(/subscription will remain active/)).toBeNull();
  });

  it("renders the scheduled-change indicator when scheduledChange is present", () => {
    render(
      <CurrentSubscriptionStatusCard
        currentTierDisplayName="Premium"
        isCancelledButActive={false}
        subscriptionEndsAt="2026-07-01T00:00:00.000Z"
        scheduledChange={{
          nextTierDisplayName: "Basic",
          effectiveAt: "2026-07-01T00:00:00.000Z",
          currentTierActiveUntil: "2026-07-01T00:00:00.000Z",
          currentTierDisplayName: "Premium",
        }}
      />,
    );
    expect(screen.getByText(/Scheduled: Basic/)).toBeTruthy();
    expect(screen.getByText(/Premium active until/)).toBeTruthy();
  });

  it("omits the 'active until' subtext when currentTierActiveUntil is null", () => {
    render(
      <CurrentSubscriptionStatusCard
        currentTierDisplayName="Premium"
        isCancelledButActive={false}
        subscriptionEndsAt={null}
        scheduledChange={{
          nextTierDisplayName: "Basic",
          effectiveAt: "2026-07-01T00:00:00.000Z",
          currentTierActiveUntil: null,
          currentTierDisplayName: "Premium",
        }}
      />,
    );
    expect(screen.queryByText(/active until/)).toBeNull();
  });
});
