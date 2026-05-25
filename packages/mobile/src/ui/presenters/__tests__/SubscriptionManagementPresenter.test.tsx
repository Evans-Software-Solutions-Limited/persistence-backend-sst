import {
  fireEvent,
  render as rawRender,
  screen,
} from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import config from "../../../../tamagui.config";
import type { SubscriptionTier } from "@/domain/models/subscription";
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

const BASIC_TIER: SubscriptionTier = {
  tierName: "basic",
  displayName: "Basic",
  description: null,
  priceMonthly: 7.99,
  priceYearly: 79.99,
  currency: "GBP",
  features: {},
  workoutLimit: 10,
  aiAccess: true,
  aiWorkoutLimit: 1,
  gymBuddyAccess: false,
  trainerClientLimit: null,
  isTrainerTier: false,
  analyticsAccess: false,
  exportAccess: false,
  stripePriceIdMonthly: "price_basic_m",
  stripePriceIdYearly: "price_basic_y",
};

const PREMIUM_TIER: SubscriptionTier = {
  ...BASIC_TIER,
  tierName: "premium",
  displayName: "Premium",
  priceMonthly: 12.99,
  priceYearly: 129.99,
};

const TRAINER_PRO_TIER: SubscriptionTier = {
  ...BASIC_TIER,
  tierName: "individual_trainer_pro",
  displayName: "Individual Trainer Pro",
  priceMonthly: 14.99,
  priceYearly: 149.99,
  isTrainerTier: true,
  trainerClientLimit: 5,
};

function defaultProps(): SubscriptionManagementPresenterProps {
  return {
    currentTier: "basic",
    currentTierDisplayName: "Basic",
    paymentStatus: "active",
    cancelledAt: null,
    scheduledChange: null,
    hasActiveSub: true,
    isTrialingState: false,
    isCancelledButActive: false,
    onFreeTier: false,
    subscriptionEndsAt: "2026-07-01T00:00:00.000Z",
    trialEndsAt: null,
    billingCycle: "monthly",
    trainerClientLimit: null,
    pickerTiers: [PREMIUM_TIER, TRAINER_PRO_TIER],
    isLoading: false,
    isChangingTier: false,
    isCancelling: false,
    canCancel: true,
    hasScheduledChange: false,
    isOffline: false,
    isSlowLoading: false,
    onChangeTier: jest.fn(),
    onCancel: jest.fn(),
    onBack: jest.fn(),
  };
}

describe("SubscriptionManagementPresenter", () => {
  it("renders the loading state when isLoading", () => {
    render(<SubscriptionManagementPresenter {...defaultProps()} isLoading />);
    expect(screen.getByTestId("subscription-management-loading")).toBeTruthy();
  });

  it("renders the current plan + active badge when hasActiveSub and not trialing/cancelled", () => {
    render(<SubscriptionManagementPresenter {...defaultProps()} />);
    expect(screen.getByText("Current Plan")).toBeTruthy();
    expect(screen.getByTestId("management-badge-active")).toBeTruthy();
    expect(screen.getByText("Basic")).toBeTruthy();
  });

  it("renders the trial badge when isTrialingState", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        isTrialingState
        trialEndsAt="2026-06-01T00:00:00.000Z"
      />,
    );
    expect(screen.getByTestId("management-badge-trial")).toBeTruthy();
    expect(screen.getByText(/Trial ends/)).toBeTruthy();
  });

  it("renders the cancelled badge + access-ends row when cancelledAt is set", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        cancelledAt="2026-05-25T14:33:31.000Z"
        isCancelledButActive
        canCancel={false}
      />,
    );
    expect(screen.getByTestId("management-badge-cancelled")).toBeTruthy();
    expect(screen.getByTestId("management-access-ends-row")).toBeTruthy();
  });

  it("hides the cancel card when already cancelled (legacy parity, bug 8a)", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        cancelledAt="2026-05-25T14:33:31.000Z"
        canCancel={false}
      />,
    );
    expect(screen.queryByTestId("management-cancel-button")).toBeNull();
  });

  it("renders the cancelled-notice card when cancelledAt + subscriptionEndsAt are set", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        cancelledAt="2026-05-25T14:33:31.000Z"
        canCancel={false}
      />,
    );
    expect(screen.getByTestId("management-cancelled-notice")).toBeTruthy();
    expect(screen.getByText(/until/)).toBeTruthy();
  });

  it("shows the cancel card with trial-aware copy when isTrialingState", () => {
    render(
      <SubscriptionManagementPresenter {...defaultProps()} isTrialingState />,
    );
    expect(
      screen.getByText(/Cancel your trial to avoid being charged/),
    ).toBeTruthy();
  });

  // Phase 2 — tier picker (replaces hardcoded Upgrade/Downgrade buttons)
  describe("tier picker (Phase 2)", () => {
    it("renders one row per picker tier with price + Switch button", () => {
      render(<SubscriptionManagementPresenter {...defaultProps()} />);
      expect(screen.getByTestId("management-picker-row-premium")).toBeTruthy();
      expect(
        screen.getByTestId("management-picker-row-individual_trainer_pro"),
      ).toBeTruthy();
      expect(screen.getByText("£12.99/month")).toBeTruthy();
      expect(screen.getByText("£14.99/month")).toBeTruthy();
    });

    it("fires onChangeTier with the tier name when a Switch button is pressed", () => {
      const onChangeTier = jest.fn();
      render(
        <SubscriptionManagementPresenter
          {...defaultProps()}
          onChangeTier={onChangeTier}
        />,
      );
      fireEvent.press(screen.getByTestId("management-picker-switch-premium"));
      expect(onChangeTier).toHaveBeenCalledWith("premium");
    });

    it("hides the picker entirely on free tier", () => {
      render(
        <SubscriptionManagementPresenter
          {...defaultProps()}
          currentTier="free"
          onFreeTier
          canCancel={false}
          pickerTiers={[]}
        />,
      );
      expect(screen.queryByTestId("management-picker-card")).toBeNull();
    });

    it("hides the picker when cancelled-but-active (no new changes allowed)", () => {
      render(
        <SubscriptionManagementPresenter
          {...defaultProps()}
          cancelledAt="2026-05-25T14:33:31.000Z"
          canCancel={false}
          isCancelledButActive
        />,
      );
      expect(screen.queryByTestId("management-picker-card")).toBeNull();
    });

    it("explains supersede-by-upgrade when hasScheduledChange", () => {
      render(
        <SubscriptionManagementPresenter
          {...defaultProps()}
          hasScheduledChange
          scheduledChange={{
            nextTierName: "basic",
            nextDisplayName: "Basic",
            effectiveAt: "2026-06-01T00:00:00.000Z",
          }}
          currentTier="premium"
          currentTierDisplayName="Premium"
          pickerTiers={[TRAINER_PRO_TIER]}
        />,
      );
      expect(
        screen.getByText(
          /Upgrade to apply immediately and replace the scheduled change/,
        ),
      ).toBeTruthy();
    });
  });

  // Phase 2 — scheduled change card
  describe("scheduled change card (Phase 2)", () => {
    it("renders when scheduledChange is set", () => {
      render(
        <SubscriptionManagementPresenter
          {...defaultProps()}
          scheduledChange={{
            nextTierName: "basic",
            nextDisplayName: "Basic",
            effectiveAt: "2026-06-01T00:00:00.000Z",
          }}
          hasScheduledChange
          currentTier="premium"
          currentTierDisplayName="Premium"
        />,
      );
      expect(screen.getByTestId("management-scheduled-card")).toBeTruthy();
      expect(screen.getByText(/Plan Change Scheduled/)).toBeTruthy();
      expect(screen.getByText(/Basic/)).toBeTruthy();
      expect(screen.getByText(/1 June 2026/)).toBeTruthy();
    });

    it("is omitted when scheduledChange is null", () => {
      render(<SubscriptionManagementPresenter {...defaultProps()} />);
      expect(screen.queryByTestId("management-scheduled-card")).toBeNull();
    });
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

  it("renders 'Free' tier display name + hides picker + cancel when on free tier", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        currentTier="free"
        currentTierDisplayName="Free"
        paymentStatus={null}
        hasActiveSub={false}
        onFreeTier
        canCancel={false}
        pickerTiers={[]}
      />,
    );
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.queryByTestId("management-cancel-button")).toBeNull();
    expect(screen.queryByTestId("management-picker-card")).toBeNull();
  });

  it("fires onBack from the header back button", () => {
    const onBack = jest.fn();
    render(
      <SubscriptionManagementPresenter {...defaultProps()} onBack={onBack} />,
    );
    fireEvent.press(screen.getByTestId("subscription-management-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // M10.5 — offline + slow-network UX
  it("renders the offline banner when isOffline (M10.5 AC 11.1)", () => {
    render(<SubscriptionManagementPresenter {...defaultProps()} isOffline />);
    expect(screen.getByTestId("subscription-offline-banner")).toBeTruthy();
  });

  it("renders the slow-loading indicator when isSlowLoading && isLoading (M10.5 AC 11.3)", () => {
    render(
      <SubscriptionManagementPresenter
        {...defaultProps()}
        isLoading
        isSlowLoading
      />,
    );
    expect(
      screen.getByTestId("subscription-management-slow-loading"),
    ).toBeTruthy();
  });
});
