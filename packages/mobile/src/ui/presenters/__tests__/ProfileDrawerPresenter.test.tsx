import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  ProfileDrawerPresenter,
  type ProfileDrawerPresenterProps,
  tierBadge,
  tierPillTone,
} from "../ProfileDrawerPresenter";

/**
 * Spec: specs/08-profile-settings/requirements.md
 *       STORY-001/002/003/004/005/006/007
 *       specs/08-profile-settings/design.md § <ProfileDrawerPresenter>
 */

const baseProps: ProfileDrawerPresenterProps = {
  visible: true,
  onClose: jest.fn(),
  profile: {
    name: "Bradley Evans",
    email: "brad@example.com",
    initials: "BE",
    age: 28,
    weightKg: 79.8,
  },
  subscription: {
    tier: "premium",
    inTrial: true,
    expiresAt: new Date("2026-06-01T00:00:00.000Z"),
    planDescription: "Unlimited workouts · AI coach · Macros",
  },
  achievementsCount: undefined,
  healthConnected: true,
  mode: "athlete",
  isTrainerEligible: false,
  clientCount: undefined,
  onSwitchMode: jest.fn(),
  onOpenProfile: jest.fn(),
  onOpenAchievements: jest.fn(),
  onOpenHealth: jest.fn(),
  onOpenSubscription: jest.fn(),
  onOpenNotifications: jest.fn(),
  onOpenSettings: jest.fn(),
  onSignOut: jest.fn(),
};

function renderDrawer(overrides: Partial<ProfileDrawerPresenterProps> = {}) {
  return renderWithTheme(<ProfileDrawerPresenter {...baseProps} {...overrides} />);
}

describe("tierBadge / tierPillTone", () => {
  it("maps tiers to badge labels", () => {
    expect(tierBadge("free")).toBeNull();
    expect(tierBadge("premium")).toBe("PREMIUM");
    expect(tierBadge("individual_trainer")).toBe("TRAINER");
    expect(tierBadge("small_business")).toBe("TRAINER");
    expect(tierBadge("medium_enterprise")).toBe("TRAINER");
  });

  it("maps tiers to pill tones", () => {
    expect(tierPillTone("free")).toBe("neutral");
    expect(tierPillTone("premium")).toBe("gold");
    expect(tierPillTone("individual_trainer")).toBe("trainer");
  });
});

describe("ProfileDrawerPresenter", () => {
  it("renders the identity block (name, email, profile-details sub w/ age)", () => {
    const { getByText } = renderDrawer();
    expect(getByText("Bradley Evans")).toBeTruthy();
    expect(getByText("brad@example.com")).toBeTruthy();
    // profile-details sub joins name · age · weight.
    expect(getByText("Bradley Evans · 28 · 79.8kg")).toBeTruthy();
  });

  it("renders the PREMIUM + trial pills from subscription", () => {
    const { getAllByText, getByText } = renderDrawer();
    // "PREMIUM" appears twice — identity-block pill + subscription-card pill.
    expect(getAllByText("PREMIUM").length).toBeGreaterThanOrEqual(1);
    expect(getByText("7-DAY TRIAL")).toBeTruthy();
  });

  it("omits age from the sub when DOB-derived age is null", () => {
    const { getByText } = renderDrawer({
      profile: { ...baseProps.profile!, age: null },
    });
    expect(getByText("Bradley Evans · 79.8kg")).toBeTruthy();
  });

  it("does NOT render the mode-switch card when ineligible", () => {
    const { queryByTestId } = renderDrawer({ isTrainerEligible: false });
    expect(queryByTestId("mode-switch-card")).toBeNull();
  });

  it("renders the mode-switch card when trainer-eligible (AC 3.1)", () => {
    const { getByTestId } = renderDrawer({ isTrainerEligible: true });
    expect(getByTestId("mode-switch-card")).toBeTruthy();
  });

  it("fires onSwitchMode from the card CTA", () => {
    const onSwitchMode = jest.fn();
    const { getByTestId } = renderDrawer({
      isTrainerEligible: true,
      mode: "athlete",
      onSwitchMode,
    });
    fireEvent.press(getByTestId("mode-switch-card-cta"));
    expect(onSwitchMode).toHaveBeenCalledWith("coach");
  });

  it("renders a COACH badge on the avatar in coach mode", () => {
    const { getByText } = renderDrawer({
      isTrainerEligible: true,
      mode: "coach",
    });
    expect(getByText("COACH")).toBeTruthy();
  });

  it("wires every row to its handler", () => {
    const handlers = {
      onOpenProfile: jest.fn(),
      onOpenAchievements: jest.fn(),
      onOpenHealth: jest.fn(),
      onOpenSubscription: jest.fn(),
      onOpenNotifications: jest.fn(),
      onOpenSettings: jest.fn(),
    };
    const { getByTestId } = renderDrawer(handlers);

    fireEvent.press(getByTestId("row-profile-details"));
    fireEvent.press(getByTestId("row-achievements"));
    fireEvent.press(getByTestId("row-health"));
    fireEvent.press(getByTestId("subscription-card-pressable"));
    fireEvent.press(getByTestId("row-notifications"));
    fireEvent.press(getByTestId("row-settings"));

    expect(handlers.onOpenProfile).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenAchievements).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenHealth).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenSubscription).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenNotifications).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("renders the health-connected dot only when connected", () => {
    const { queryByTestId, rerender } = renderDrawer({ healthConnected: true });
    expect(queryByTestId("health-connected-dot")).toBeTruthy();

    rerender(
      <ProfileDrawerPresenter {...baseProps} healthConnected={false} />,
    );
    expect(queryByTestId("health-connected-dot")).toBeNull();
  });

  it("omits the achievements pill until a count is supplied", () => {
    const { queryByText, rerender } = renderDrawer({
      achievementsCount: undefined,
    });
    // No "N of 12 unlocked" sub yet.
    expect(queryByText(/of 12 unlocked/)).toBeNull();

    rerender(<ProfileDrawerPresenter {...baseProps} achievementsCount={3} />);
    expect(queryByText("3 of 12 unlocked")).toBeTruthy();
  });

  it("hides the Subscription section while subscription is unresolved", () => {
    const { queryByTestId } = renderDrawer({ subscription: undefined });
    expect(queryByTestId("subscription-card-pressable")).toBeNull();
  });

  it("renders a loading state when profile is undefined", () => {
    const { getByText } = renderDrawer({ profile: undefined });
    expect(getByText("Loading…")).toBeTruthy();
  });

  it("loading state close button fires onClose", () => {
    const onClose = jest.fn();
    const { getByLabelText } = renderDrawer({ profile: undefined, onClose });
    fireEvent.press(getByLabelText("Close profile menu"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("free-tier subscription: no identity badge, FREE pill on the card", () => {
    const { queryByText, getAllByText } = renderDrawer({
      subscription: {
        tier: "free",
        inTrial: false,
        expiresAt: undefined,
        planDescription: "Free plan",
      },
    });
    // No PREMIUM/TRAINER badge anywhere.
    expect(queryByText("PREMIUM")).toBeNull();
    // The subscription card shows the FREE fallback pill.
    expect(getAllByText("FREE").length).toBeGreaterThanOrEqual(1);
  });

  it("trainer-tier subscription shows the TRAINER badge", () => {
    const { getAllByText } = renderDrawer({
      subscription: {
        tier: "individual_trainer",
        inTrial: false,
        expiresAt: undefined,
        planDescription: "Coach plan",
      },
    });
    expect(getAllByText("TRAINER").length).toBeGreaterThanOrEqual(1);
  });

  it("sign-out: tapping the row opens the confirm dialog, confirm fires onSignOut", () => {
    const onSignOut = jest.fn();
    const { getByTestId, queryByTestId } = renderDrawer({ onSignOut });

    // Dialog not shown initially.
    expect(queryByTestId("sign-out-confirm")).toBeNull();

    fireEvent.press(getByTestId("sign-out-row"));
    expect(getByTestId("sign-out-confirm")).toBeTruthy();

    fireEvent.press(getByTestId("sign-out-confirm-confirm"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("sign-out: cancel closes the dialog without firing onSignOut", () => {
    const onSignOut = jest.fn();
    const { getByTestId, queryByTestId } = renderDrawer({ onSignOut });

    fireEvent.press(getByTestId("sign-out-row"));
    fireEvent.press(getByTestId("sign-out-confirm-cancel"));
    expect(queryByTestId("sign-out-confirm")).toBeNull();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("fires onClose from the header close button", () => {
    const onClose = jest.fn();
    const { getByLabelText } = renderDrawer({ onClose });
    fireEvent.press(getByLabelText("Close profile menu"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
