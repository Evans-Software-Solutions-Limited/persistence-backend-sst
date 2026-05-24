import {
  fireEvent,
  render as rawRender,
  screen,
} from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import config from "../../../../tamagui.config";
import {
  SubscriptionManagementPresenter,
  type SubscriptionManagementPresenterProps,
} from "@/ui/presenters/SubscriptionManagementPresenter";

function render(ui: React.ReactElement) {
  return rawRender(
    <TamaguiProvider config={config} defaultTheme="dark">
      {ui}
    </TamaguiProvider>,
  );
}

function defaultProps(): SubscriptionManagementPresenterProps {
  return {
    currentTier: "basic",
    paymentStatus: "active",
    nextBillingDate: "2026-07-01T00:00:00.000Z",
    subscriptionEndsAt: "2026-07-01T00:00:00.000Z",
    trialEndsAt: null,
    billingCycle: "monthly",
    displayBillingDate: "2026-07-01T00:00:00.000Z",
    trainerClientLimit: null,
    isLoading: false,
    isUpgrading: false,
    isDowngrading: false,
    isCancelling: false,
    canUpgrade: true,
    canDowngrade: false,
    canCancel: true,
    onUpgrade: jest.fn(),
    onDowngrade: jest.fn(),
    onCancel: jest.fn(),
    onBack: jest.fn(),
  };
}

describe("SubscriptionManagementPresenter", () => {
  it("renders the loading state when isLoading", () => {
    render(<SubscriptionManagementPresenter {...defaultProps()} isLoading />);
    expect(screen.getByTestId("subscription-management-loading")).toBeTruthy();
  });

  it("renders the current plan + active badge for active subs", () => {
    render(<SubscriptionManagementPresenter {...defaultProps()} />);
    expect(screen.getByText("Current Plan")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Basic")).toBeTruthy();
  });

  it("renders the trial badge when paymentStatus is 'trialing'", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        paymentStatus="trialing"
        trialEndsAt="2026-06-01T00:00:00.000Z"
      />,
    );
    expect(screen.getByText("Trial")).toBeTruthy();
    expect(screen.getByText(/Trial ends/)).toBeTruthy();
  });

  it("renders the cancelled badge + access-ends row for cancelled subs", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        paymentStatus="cancelled"
      />,
    );
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getByText(/Access ends/)).toBeTruthy();
  });

  it("shows the upgrade card when canUpgrade", () => {
    const onUpgrade = jest.fn();
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        canUpgrade
        onUpgrade={onUpgrade}
      />,
    );
    fireEvent.press(screen.getByTestId("management-upgrade-button"));
    expect(onUpgrade).toHaveBeenCalledWith("premium");
  });

  it("shows the downgrade card when canDowngrade", () => {
    const onDowngrade = jest.fn();
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        currentTier="premium"
        canUpgrade={false}
        canDowngrade
        onDowngrade={onDowngrade}
      />,
    );
    fireEvent.press(screen.getByTestId("management-downgrade-button"));
    expect(onDowngrade).toHaveBeenCalledWith("basic");
  });

  it("shows the cancel card with trial-aware copy when paymentStatus is 'trialing'", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        paymentStatus="trialing"
        canUpgrade={false}
      />,
    );
    expect(
      screen.getByText(/Cancel your trial to avoid being charged/),
    ).toBeTruthy();
  });

  it("does not show the cancel card when paymentStatus is 'cancelled'", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        paymentStatus="cancelled"
        canCancel
      />,
    );
    expect(screen.queryByTestId("management-cancel-button")).toBeNull();
  });

  it("renders the cancelled-notice card with access-ends date", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        paymentStatus="cancelled"
      />,
    );
    expect(screen.getByText("Subscription Cancelled")).toBeTruthy();
    expect(screen.getByText(/until/)).toBeTruthy();
  });

  it("renders the trainer client slots row when set", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        trainerClientLimit={25}
      />,
    );
    expect(screen.getByText("Client slots: 25")).toBeTruthy();
  });

  it("renders the billing cycle row (title-cased)", () => {
    render(<SubscriptionManagementPresenter {...defaultProps()} />);
    expect(screen.getByText("Billing: Monthly")).toBeTruthy();
  });

  it("renders 'Free' tier display name when currentTier is 'free'", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        currentTier="free"
        paymentStatus={null}
        canUpgrade={false}
        canCancel={false}
      />,
    );
    expect(screen.getByText("Free")).toBeTruthy();
  });

  it("fires onBack from the header back button", () => {
    const onBack = jest.fn();
    render(
      <SubscriptionManagementPresenter {...defaultProps()} onBack={onBack} />,
    );
    fireEvent.press(screen.getByTestId("subscription-management-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
