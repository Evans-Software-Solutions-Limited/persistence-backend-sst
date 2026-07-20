import { fireEvent } from "@testing-library/react-native";
import type {
  ProfilePageAchievement,
  ProfilePageSubscription,
  ProfilePageTrainerRef,
} from "@/domain/models/profilePage";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ProfilePresenter } from "../ProfilePresenter";

function freeSubscription(): ProfilePageSubscription {
  return {
    tierName: null,
    tierDisplayName: null,
    status: null,
    isFreeTier: true,
    isTrainerTier: false,
    expiresAt: null,
    cancelledAt: null,
    workoutLimit: null,
    isUnlimited: false,
  };
}

function activePaidSubscription(): ProfilePageSubscription {
  return {
    tierName: "premium",
    tierDisplayName: "Premium",
    status: "active",
    isFreeTier: false,
    isTrainerTier: false,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    cancelledAt: null,
    workoutLimit: null,
    isUnlimited: true,
  };
}

function makeProps(
  overrides: Partial<Parameters<typeof ProfilePresenter>[0]> = {},
): Parameters<typeof ProfilePresenter>[0] {
  return {
    isInitialLoading: false,
    isRefreshing: false,
    errorMessage: null,
    displayName: "Brad Simms",
    badge: null,
    email: "brad@example.com",
    avatarUrl: null,
    avatarCacheKey: 0,
    isAvatarWorking: false,
    userRoleLabel: "User",
    subscription: freeSubscription(),
    isTrainer: false,
    workoutsCompleted: 12,
    recentAchievements: [],
    activeTrainers: [],
    pendingTrainerRequests: [],
    onLeaveTrainer: jest.fn(),
    appVersion: "1.1.1",
    isSigningOut: false,
    onRefresh: jest.fn(),
    onSelectProfilePicture: jest.fn(),
    onManageSubscription: jest.fn(),
    onUpgradeSubscription: jest.fn(),
    onBecomeTrainer: jest.fn(),
    onEditProfile: jest.fn(),
    onHealthData: jest.fn(),
    onNotifications: jest.fn(),
    onNotificationPreferences: jest.fn(),
    onSignOut: jest.fn(),
    onHelpCenter: jest.fn(),
    onContactSupport: jest.fn(),
    onTermsOfService: jest.fn(),
    onPrivacyPolicy: jest.fn(),
    ...overrides,
  };
}

describe("ProfilePresenter", () => {
  it("renders the loader when isInitialLoading is true", () => {
    const { queryByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ isInitialLoading: true })} />,
    );
    expect(queryByTestId("profile-screen")).toBeTruthy();
    expect(queryByTestId("subscription-card")).toBeNull();
  });

  it("renders header name + email", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps()} />,
    );
    expect(getByTestId("profile-name").props.children).toBe("Brad Simms");
    expect(getByTestId("profile-email").props.children).toBe(
      "brad@example.com",
    );
  });

  it("falls back to 'User' when displayName is null", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ displayName: null })} />,
    );
    expect(getByTestId("profile-name").props.children).toBe("User");
  });

  it("renders the Free Tier subscription card when isFreeTier", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps()} />,
    );
    const card = getByTestId("subscription-card");
    expect(card).toBeTruthy();
  });

  it("calls onUpgradeSubscription when free-tier card is tapped", () => {
    const onUpgradeSubscription = jest.fn();
    const onManageSubscription = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({ onUpgradeSubscription, onManageSubscription })}
      />,
    );
    fireEvent.press(getByTestId("subscription-card"));
    expect(onUpgradeSubscription).toHaveBeenCalledTimes(1);
    expect(onManageSubscription).not.toHaveBeenCalled();
  });

  it("calls onManageSubscription when paid card is tapped", () => {
    const onUpgradeSubscription = jest.fn();
    const onManageSubscription = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: activePaidSubscription(),
          onUpgradeSubscription,
          onManageSubscription,
        })}
      />,
    );
    fireEvent.press(getByTestId("subscription-card"));
    expect(onManageSubscription).toHaveBeenCalledTimes(1);
    expect(onUpgradeSubscription).not.toHaveBeenCalled();
  });

  it("shows the trainer promo banner for non-trainer users", () => {
    const { queryByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ isTrainer: false })} />,
    );
    expect(queryByTestId("become-trainer-button")).toBeTruthy();
  });

  it("hides the trainer promo + shows the trainer-stats placeholder when isTrainer", () => {
    const { queryByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ isTrainer: true })} />,
    );
    expect(queryByTestId("become-trainer-button")).toBeNull();
    expect(queryByTestId("trainer-stats-placeholder")).toBeTruthy();
  });

  it("renders empty states for active trainers + pending requests when collections are empty", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps()} />,
    );
    expect(getByTestId("active-trainers-empty")).toBeTruthy();
    expect(getByTestId("pending-requests-empty")).toBeTruthy();
  });

  it("renders trainer cards when activeTrainers is populated", () => {
    const trainers: ProfilePageTrainerRef[] = [
      {
        id: "rel-1",
        trainer: { id: "tr-1", fullName: "Coach K", avatarUrl: null },
      },
    ];
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ activeTrainers: trainers })} />,
    );
    expect(getByTestId("active-trainer-rel-1")).toBeTruthy();
    expect(queryByTestId("active-trainers-empty")).toBeNull();
  });

  // Spec 25 coach↔client offboarding AC-4.2 — each active-trainer row exposes
  // a "Leave coach" affordance. The presenter stays pure: it just forwards
  // the relationship id + coach name so the container can own the confirm.
  it("fires onLeaveTrainer with the relationship id + coach name from the row", () => {
    const trainers: ProfilePageTrainerRef[] = [
      {
        id: "rel-1",
        trainer: { id: "tr-1", fullName: "Coach K", avatarUrl: null },
      },
    ];
    const onLeaveTrainer = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({ activeTrainers: trainers, onLeaveTrainer })}
      />,
    );
    fireEvent.press(getByTestId("leave-trainer-rel-1"));
    expect(onLeaveTrainer).toHaveBeenCalledWith("rel-1", "Coach K");
  });

  it("renders achievement cards when achievements are present", () => {
    const achievements: ProfilePageAchievement[] = [
      {
        id: "ach-1",
        name: "First workout",
        description: "Got started",
        iconUrl: null,
        unlockedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ recentAchievements: achievements })} />,
    );
    expect(getByTestId("achievement-ach-1")).toBeTruthy();
  });

  it("renders the workoutsCompleted stat", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ workoutsCompleted: 42 })} />,
    );
    expect(getByTestId("workouts-completed").props.children).toBe(42);
  });

  it("fires the avatar tap handler", () => {
    const onSelectProfilePicture = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ onSelectProfilePicture })} />,
    );
    fireEvent.press(getByTestId("profile-avatar-button"));
    expect(onSelectProfilePicture).toHaveBeenCalledTimes(1);
  });

  it("fires each account menu handler", () => {
    const onEditProfile = jest.fn();
    const onHealthData = jest.fn();
    const onNotifications = jest.fn();
    const onNotificationPreferences = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          onEditProfile,
          onHealthData,
          onNotifications,
          onNotificationPreferences,
        })}
      />,
    );
    fireEvent.press(getByTestId("menu-edit-profile"));
    fireEvent.press(getByTestId("menu-health-data"));
    fireEvent.press(getByTestId("menu-notifications"));
    fireEvent.press(getByTestId("menu-notification-preferences"));
    expect(onEditProfile).toHaveBeenCalledTimes(1);
    expect(onHealthData).toHaveBeenCalledTimes(1);
    expect(onNotifications).toHaveBeenCalledTimes(1);
    expect(onNotificationPreferences).toHaveBeenCalledTimes(1);
  });

  it("fires each support menu handler", () => {
    const onHelpCenter = jest.fn();
    const onContactSupport = jest.fn();
    const onTermsOfService = jest.fn();
    const onPrivacyPolicy = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          onHelpCenter,
          onContactSupport,
          onTermsOfService,
          onPrivacyPolicy,
        })}
      />,
    );
    fireEvent.press(getByTestId("menu-help-center"));
    fireEvent.press(getByTestId("menu-contact-support"));
    fireEvent.press(getByTestId("menu-terms"));
    fireEvent.press(getByTestId("menu-privacy"));
    expect(onHelpCenter).toHaveBeenCalledTimes(1);
    expect(onContactSupport).toHaveBeenCalledTimes(1);
    expect(onTermsOfService).toHaveBeenCalledTimes(1);
    expect(onPrivacyPolicy).toHaveBeenCalledTimes(1);
  });

  it("fires the trainer-promo handler", () => {
    const onBecomeTrainer = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ onBecomeTrainer })} />,
    );
    fireEvent.press(getByTestId("become-trainer-button"));
    expect(onBecomeTrainer).toHaveBeenCalledTimes(1);
  });

  it("fires onSignOut when the sign-out button is tapped", () => {
    const onSignOut = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ onSignOut })} />,
    );
    fireEvent.press(getByTestId("sign-out-button"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("disables the sign-out button when isSigningOut", () => {
    const onSignOut = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ isSigningOut: true, onSignOut })} />,
    );
    fireEvent.press(getByTestId("sign-out-button"));
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("renders the error banner when errorMessage is set", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ errorMessage: "Network down" })} />,
    );
    expect(getByTestId("profile-error-banner")).toBeTruthy();
  });

  it("hides the error banner when errorMessage is null", () => {
    const { queryByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ errorMessage: null })} />,
    );
    expect(queryByTestId("profile-error-banner")).toBeNull();
  });

  it("renders the app version with v-prefix", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ appVersion: "1.2.3" })} />,
    );
    expect(getByTestId("app-version").props.children).toEqual([
      "Persistence v",
      "1.2.3",
    ]);
  });

  it("renders the active-paid subscription card with renew copy", () => {
    const expiresAt = new Date("2026-12-31T00:00:00.000Z").toISOString();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: {
            ...activePaidSubscription(),
            expiresAt,
          },
        })}
      />,
    );
    expect(getByTestId("subscription-card")).toBeTruthy();
  });

  it("renders the cancelled subscription card with end copy + warning badge", () => {
    const expiresAt = new Date(
      Date.now() + 1000 * 60 * 60 * 24 * 5,
    ).toISOString();
    const cancelledAt = new Date().toISOString();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: {
            ...activePaidSubscription(),
            status: "cancelled",
            cancelledAt,
            expiresAt,
            isUnlimited: false,
            workoutLimit: 5,
          },
        })}
      />,
    );
    expect(getByTestId("subscription-card")).toBeTruthy();
  });

  it("renders a trialing badge when status is trialing", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: { ...activePaidSubscription(), status: "trialing" },
        })}
      />,
    );
    expect(getByTestId("subscription-card")).toBeTruthy();
  });

  it("renders no status badge when status is past_due (unknown)", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: { ...activePaidSubscription(), status: "past_due" },
        })}
      />,
    );
    expect(getByTestId("subscription-card")).toBeTruthy();
  });

  it("falls back to title-cased tier name when display name is missing", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: {
            ...activePaidSubscription(),
            tierDisplayName: null,
            tierName: "premium_annual",
          },
        })}
      />,
    );
    expect(getByTestId("subscription-card")).toBeTruthy();
  });

  it("falls back to a generic label when both display name and tier name are missing", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: {
            ...activePaidSubscription(),
            tierDisplayName: null,
            tierName: null,
          },
        })}
      />,
    );
    expect(getByTestId("subscription-card")).toBeTruthy();
  });

  it("renders the paid card with a workoutLimit when not unlimited", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: {
            ...activePaidSubscription(),
            isUnlimited: false,
            workoutLimit: 12,
          },
        })}
      />,
    );
    expect(getByTestId("subscription-card")).toBeTruthy();
  });

  it("renders the paid card without a date when expiresAt is null", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: {
            ...activePaidSubscription(),
            expiresAt: null,
          },
        })}
      />,
    );
    expect(getByTestId("subscription-card")).toBeTruthy();
  });

  it("renders the cancelled warning with no day-count when expiry is already past", () => {
    const expiresAt = new Date(
      Date.now() - 1000 * 60 * 60 * 24 * 2,
    ).toISOString();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: {
            ...activePaidSubscription(),
            status: "cancelled",
            cancelledAt: new Date().toISOString(),
            expiresAt,
            isUnlimited: false,
            workoutLimit: 3,
          },
        })}
      />,
    );
    expect(getByTestId("subscription-card")).toBeTruthy();
  });

  it("renders the cancelled warning with '1 day left' singular wording", () => {
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: {
            ...activePaidSubscription(),
            status: "cancelled",
            cancelledAt: new Date().toISOString(),
            expiresAt,
            isUnlimited: false,
            workoutLimit: 3,
          },
        })}
      />,
    );
    expect(getByTestId("subscription-card")).toBeTruthy();
  });

  it("falls back to empty date when expiresAt is unparseable", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          subscription: {
            ...activePaidSubscription(),
            expiresAt: "not-a-date",
          },
        })}
      />,
    );
    expect(getByTestId("subscription-card")).toBeTruthy();
  });

  it("renders trophy emoji when an achievement has an iconUrl", () => {
    const achievements: ProfilePageAchievement[] = [
      {
        id: "ach-9",
        name: "Streak",
        description: null,
        iconUrl: "https://example.com/icon.png",
        unlockedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ recentAchievements: achievements })} />,
    );
    expect(getByTestId("achievement-ach-9")).toBeTruthy();
  });

  it("renders trainer cards with the avatar image when populated", () => {
    const trainers: ProfilePageTrainerRef[] = [
      {
        id: "rel-2",
        trainer: {
          id: "tr-2",
          fullName: "Coach K",
          avatarUrl: "https://example.com/avatar.png",
        },
      },
    ];
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ activeTrainers: trainers })} />,
    );
    expect(getByTestId("active-trainer-rel-2")).toBeTruthy();
  });

  it("renders pending request cards with avatar + fallback initials", () => {
    const requests: ProfilePageTrainerRef[] = [
      {
        id: "req-1",
        trainer: {
          id: "tr-3",
          fullName: null,
          avatarUrl: null,
        },
      },
    ];
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ pendingTrainerRequests: requests })} />,
    );
    expect(getByTestId("pending-request-req-1")).toBeTruthy();
  });

  it("renders pending request avatar image when present", () => {
    const requests: ProfilePageTrainerRef[] = [
      {
        id: "req-2",
        trainer: {
          id: "tr-4",
          fullName: "Coach P",
          avatarUrl: "https://example.com/p.png",
        },
      },
    ];
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ pendingTrainerRequests: requests })} />,
    );
    expect(getByTestId("pending-request-req-2")).toBeTruthy();
  });

  it("renders the header avatar image when avatarUrl is set", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({ avatarUrl: "https://example.com/me.png" })}
      />,
    );
    expect(getByTestId("profile-avatar-image")).toBeTruthy();
  });

  it("appends the avatarCacheKey as a _cb query param so RN's image cache is bypassed", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          avatarUrl: "https://example.com/me.png",
          avatarCacheKey: 3,
        })}
      />,
    );
    const image = getByTestId("profile-avatar-image");
    expect(image.props.source.uri).toBe("https://example.com/me.png?_cb=3");
  });

  it("uses & separator when avatarUrl already has a query string", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          avatarUrl: "https://example.com/me.png?v=42",
          avatarCacheKey: 2,
        })}
      />,
    );
    const image = getByTestId("profile-avatar-image");
    expect(image.props.source.uri).toBe(
      "https://example.com/me.png?v=42&_cb=2",
    );
  });

  it("disables the avatar tap while isAvatarWorking is true", () => {
    const onSelectProfilePicture = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({
          isAvatarWorking: true,
          onSelectProfilePicture,
        })}
      />,
    );
    fireEvent.press(getByTestId("profile-avatar-button"));
    expect(onSelectProfilePicture).not.toHaveBeenCalled();
  });

  describe("SubscriptionBadge placement (M10.5 Wave 2)", () => {
    it("omits the badge when the badge prop is null (cache not resolved yet)", () => {
      const { queryByTestId } = renderWithTheme(
        <ProfilePresenter {...makeProps({ badge: null })} />,
      );
      expect(queryByTestId("profile-subscription-badge")).toBeNull();
    });

    it("renders the badge next to the display name for an active free user", () => {
      const { getByTestId, getByText } = renderWithTheme(
        <ProfilePresenter
          {...makeProps({
            badge: { tier: "free", paymentStatus: "active" },
          })}
        />,
      );
      expect(getByTestId("profile-subscription-badge")).toBeTruthy();
      expect(getByTestId("subscription-badge-free")).toBeTruthy();
      // Display name + chip should both be visible in the header row.
      expect(getByText("Brad Simms")).toBeTruthy();
      expect(getByText("Free")).toBeTruthy();
    });

    it.each([
      ["premium", "active", "Premium"],
      ["individual_trainer", "active", "Trainer"],
      ["small_business", "active", "Business Trainer"],
      ["medium_enterprise", "active", "Enterprise Trainer"],
    ] as const)(
      "renders the badge for tier %s with label %s",
      (tier, paymentStatus, label) => {
        const { getByText, getByTestId } = renderWithTheme(
          <ProfilePresenter
            {...makeProps({ badge: { tier, paymentStatus } })}
          />,
        );
        expect(getByTestId(`subscription-badge-${tier}`)).toBeTruthy();
        expect(getByText(label)).toBeTruthy();
      },
    );

    it("appends the Trial suffix when paymentStatus is trialing", () => {
      const { getByText } = renderWithTheme(
        <ProfilePresenter
          {...makeProps({
            badge: { tier: "premium", paymentStatus: "trialing" },
          })}
        />,
      );
      expect(getByText("Premium · Trial")).toBeTruthy();
    });

    it("appends the Cancelled suffix when paymentStatus is cancelled", () => {
      const { getByText } = renderWithTheme(
        <ProfilePresenter
          {...makeProps({
            badge: { tier: "premium", paymentStatus: "cancelled" },
          })}
        />,
      );
      expect(getByText("Premium · Cancelled")).toBeTruthy();
    });
  });

  it("exposes an accessible name for the icon-only profile-picture button", () => {
    const { getByLabelText } = renderWithTheme(
      <ProfilePresenter {...makeProps()} />,
    );
    expect(getByLabelText("Change profile picture")).toBeTruthy();
  });
});
