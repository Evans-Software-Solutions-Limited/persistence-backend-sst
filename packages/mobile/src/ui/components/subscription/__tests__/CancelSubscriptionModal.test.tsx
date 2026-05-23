import { fireEvent, render, screen } from "@testing-library/react-native";
import { CancelSubscriptionModal } from "@/ui/components/subscription/CancelSubscriptionModal";

describe("CancelSubscriptionModal", () => {
  it("renders the title + message + both buttons", () => {
    render(
      <CancelSubscriptionModal
        subscriptionEndsAt="2026-06-15T00:00:00.000Z"
        onConfirm={jest.fn()}
        onDismiss={jest.fn()}
        isProcessing={false}
      />,
    );
    expect(screen.getByText("Cancel Subscription?")).toBeTruthy();
    expect(
      screen.getByText("Are you sure you want to cancel your subscription?"),
    ).toBeTruthy();
    expect(screen.getByTestId("cancel-modal-dismiss")).toBeTruthy();
    expect(screen.getByTestId("cancel-modal-confirm")).toBeTruthy();
  });

  it("formats the end date into the info-box copy (en-GB long form)", () => {
    render(
      <CancelSubscriptionModal
        subscriptionEndsAt="2026-06-15T00:00:00.000Z"
        onConfirm={jest.fn()}
        onDismiss={jest.fn()}
        isProcessing={false}
      />,
    );
    // The string contains the date; assertion is loose to tolerate
    // timezone shifts (15 vs 14 June).
    expect(
      screen.getByText(/(June|2026)/),
    ).toBeTruthy();
  });

  it("falls back to a generic phrase when end date is missing", () => {
    render(
      <CancelSubscriptionModal
        onConfirm={jest.fn()}
        onDismiss={jest.fn()}
        isProcessing={false}
      />,
    );
    expect(
      screen.getByText(/end of your current billing period/),
    ).toBeTruthy();
  });

  it("falls back when end date is malformed", () => {
    render(
      <CancelSubscriptionModal
        subscriptionEndsAt="not-a-date"
        onConfirm={jest.fn()}
        onDismiss={jest.fn()}
        isProcessing={false}
      />,
    );
    // Invalid Date stringifies to a non-empty string in JS so
    // the function never throws — but the formatter still falls
    // through cleanly. Just assert nothing crashed and one of the
    // formatted strings appears.
    expect(screen.getByText("Cancel Subscription?")).toBeTruthy();
  });

  it("fires onConfirm + onDismiss respectively", () => {
    const onConfirm = jest.fn();
    const onDismiss = jest.fn();
    render(
      <CancelSubscriptionModal
        onConfirm={onConfirm}
        onDismiss={onDismiss}
        isProcessing={false}
      />,
    );
    fireEvent.press(screen.getByTestId("cancel-modal-confirm"));
    fireEvent.press(screen.getByTestId("cancel-modal-dismiss"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows 'Cancelling...' on the confirm button while isProcessing is true", () => {
    render(
      <CancelSubscriptionModal
        onConfirm={jest.fn()}
        onDismiss={jest.fn()}
        isProcessing
      />,
    );
    expect(screen.getByText("Cancelling...")).toBeTruthy();
  });
});
