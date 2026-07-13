import { fireEvent, render, screen } from "@testing-library/react-native";
import { SyncFailedBanner } from "@/ui/components/subscription/SyncFailedBanner";

describe("SyncFailedBanner", () => {
  it("renders nothing when total is 0", () => {
    render(<SyncFailedBanner total={0} onReview={jest.fn()} />);
    expect(screen.queryByTestId("sync-failed-banner")).toBeNull();
  });

  it("renders the count when entries have failed", () => {
    render(<SyncFailedBanner total={5} onReview={jest.fn()} />);
    expect(screen.getByTestId("sync-failed-banner")).toBeTruthy();
    expect(screen.getByText(/5 items failed to sync/)).toBeTruthy();
  });

  it("uses singular wording for total === 1", () => {
    render(<SyncFailedBanner total={1} onReview={jest.fn()} />);
    expect(screen.getByText(/^1 item failed to sync/)).toBeTruthy();
  });

  it("calls onReview when the Review chip is tapped", () => {
    const onReview = jest.fn();
    render(<SyncFailedBanner total={2} onReview={onReview} />);
    fireEvent.press(screen.getByTestId("sync-failed-banner-review"));
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
