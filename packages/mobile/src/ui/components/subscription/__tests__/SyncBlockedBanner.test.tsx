import { fireEvent, render, screen } from "@testing-library/react-native";
import { SyncBlockedBanner } from "@/ui/components/subscription/SyncBlockedBanner";

describe("SyncBlockedBanner", () => {
  it("renders nothing when total is 0", () => {
    render(
      <SyncBlockedBanner
        total={0}
        upgradeTargetLabel="Premium"
        onReview={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("sync-blocked-banner")).toBeNull();
  });

  it("renders the count + upgrade hint when entries are blocked", () => {
    render(
      <SyncBlockedBanner
        total={5}
        upgradeTargetLabel="Premium"
        onReview={jest.fn()}
      />,
    );
    expect(screen.getByTestId("sync-blocked-banner")).toBeTruthy();
    expect(
      screen.getByText(/5 items couldn.t sync — Upgrade to Premium/),
    ).toBeTruthy();
  });

  it("uses singular wording for total === 1", () => {
    render(
      <SyncBlockedBanner
        total={1}
        upgradeTargetLabel="Premium"
        onReview={jest.fn()}
      />,
    );
    expect(screen.getByText(/^1 item couldn.t sync/)).toBeTruthy();
  });

  it("falls back to generic CTA when upgradeTargetLabel is null", () => {
    render(
      <SyncBlockedBanner
        total={3}
        upgradeTargetLabel={null}
        onReview={jest.fn()}
      />,
    );
    expect(screen.getByText(/Upgrade your plan/)).toBeTruthy();
  });

  it("calls onReview when the Review chip is tapped", () => {
    const onReview = jest.fn();
    render(
      <SyncBlockedBanner
        total={2}
        upgradeTargetLabel="Premium"
        onReview={onReview}
      />,
    );
    fireEvent.press(screen.getByTestId("sync-blocked-banner-review"));
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
