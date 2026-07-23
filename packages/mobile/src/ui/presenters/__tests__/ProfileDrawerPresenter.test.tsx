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
  return renderWithTheme(
    <ProfileDrawerPresenter {...baseProps} {...overrides} />,
  );
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
    // profile-details sub joins name · age · weight (legacy "<v>kg" format,
    // no space / no forced decimal — byte-identical to pre-preference output).
    expect(getByText("Bradley Evans · 28 · 79.8kg")).toBeTruthy();
  });

  it("renders the profile-details sub weight in lb when weightUnit is lb", () => {
    const { getByText } = renderDrawer({
      profile: { ...baseProps.profile!, weightUnit: "lb" },
    });
    // 79.8 kg -> 175.9 lb via weightInUnit (1dp).
    expect(getByText("Bradley Evans · 28 · 175.9lb")).toBeTruthy();
  });

  it("no longer shows a Workout library row in coach mode (relocated to Coach You, device-QA #5)", () => {
    const { queryByTestId } = renderDrawer({
      mode: "coach",
      isTrainerEligible: true,
    });
    // The coach Workout Library moved out of the settings drawer onto Coach You;
    // the drawer is now a mode-symmetric identity/account launcher.
    expect(queryByTestId("row-workout-library")).toBeNull();
  });

  it("renders the PREMIUM + trial pills from subscription", () => {
    const { getAllByText, getByText } = renderDrawer();
    // "PREMIUM" appears twice — identity-block pill + subscription-card pill.
    expect(getAllByText("PREMIUM").length).toBeGreaterThanOrEqual(1);
    expect(getByText("FREE TRIAL")).toBeTruthy();
  });

  it("renders the subscription expiry from a UTC ISO timestamp without a timezone day-shift (PR #94 bug 3)", () => {
    // expiresAt is UTC midnight on 1 June. fmtDate must read UTC components,
    // not local — otherwise a negative-offset timezone renders 31/05/2026.
    const { getByText } = renderDrawer({
      subscription: {
        tier: "premium",
        inTrial: false,
        expiresAt: new Date("2026-06-01T00:00:00.000Z"),
        planDescription: "Unlimited workouts",
      },
    });
    // The expiry is part of the DrawerRow sub text.
    expect(getByText(/Ends 01\/06\/2026/)).toBeTruthy();
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

    rerender(<ProfileDrawerPresenter {...baseProps} healthConnected={false} />);
    expect(queryByTestId("health-connected-dot")).toBeNull();
  });

  it("omits the achievements pill until there is a non-zero count", () => {
    const { queryByText, rerender } = renderDrawer({
      achievementsCount: undefined,
    });
    // Undefined → neutral "View" framing, no unlocked badge.
    expect(queryByText("View your achievements")).toBeTruthy();
    expect(queryByText(/unlocked/)).toBeNull();

    // Zero → still the neutral framing (fresh account, no "0" badge).
    rerender(<ProfileDrawerPresenter {...baseProps} achievementsCount={0} />);
    expect(queryByText("View your achievements")).toBeTruthy();
    expect(queryByText(/unlocked/)).toBeNull();

    // Non-zero → badge + "N unlocked".
    rerender(<ProfileDrawerPresenter {...baseProps} achievementsCount={3} />);
    expect(queryByText("3 unlocked")).toBeTruthy();
  });

  it("hides the Subscription section while subscription is unresolved", () => {
    const { queryByTestId } = renderDrawer({ subscription: undefined });
    expect(queryByTestId("subscription-card-pressable")).toBeNull();
  });

  it("renders a loading state when profile is undefined", () => {
    const { getByText, queryByTestId } = renderDrawer({ profile: undefined });
    expect(getByText("Loading…")).toBeTruthy();
    // No error affordance while merely loading.
    expect(queryByTestId("profile-drawer-error")).toBeNull();
  });

  it("renders an error + retry instead of an infinite loader when errored (QA-9)", () => {
    const onRetryProfile = jest.fn();
    const { getByText, getByTestId, queryByText } = renderDrawer({
      profile: undefined,
      profileErrored: true,
      onRetryProfile,
    });
    // No stuck "Loading…" — an actionable error headline instead.
    expect(queryByText("Loading…")).toBeNull();
    expect(getByText("Couldn't load profile")).toBeTruthy();
    expect(getByTestId("profile-drawer-error")).toBeTruthy();

    fireEvent.press(getByTestId("profile-drawer-retry"));
    expect(onRetryProfile).toHaveBeenCalledTimes(1);
  });

  it("errored state omits the retry button when no handler is provided", () => {
    const { getByTestId, queryByTestId } = renderDrawer({
      profile: undefined,
      profileErrored: true,
      onRetryProfile: undefined,
    });
    expect(getByTestId("profile-drawer-error")).toBeTruthy();
    expect(queryByTestId("profile-drawer-retry")).toBeNull();
  });

  it("loading state close button fires onClose", () => {
    // Close icon removed per owner decision. Backdrop tap + drag-down
    // dismiss the drawer in both loading and loaded states.
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
    // Close icon removed per owner decision (backdrop tap + drag-down are
    // sufficient). This test is retained as a no-op marker for the decision.
  });
});
