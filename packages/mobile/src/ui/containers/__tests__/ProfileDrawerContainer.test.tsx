import { act } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../__tests__/test-utils";

/**
 * ProfileDrawerContainer tests — the 08-profile-settings composition.
 *
 * Spec: specs/08-profile-settings/design.md § <ProfileDrawerContainer>
 *       + § Revised 2026-05-31 § G (real-hook plumbing)
 *       specs/08-profile-settings/requirements.md STORY-001/004/007
 *
 * The container is the only place the real hooks are wired, so we mock the
 * hooks to capture the props handed to <ProfileDrawerPresenter> and assert
 * the wiring (visible tracks useDrawer().open, profile/subscription mapping,
 * row navigation closes the drawer + pushes the right route, sign-out).
 * The presenter itself is mocked to a capture component (its rendering is
 * covered by ProfileDrawerPresenter.test.tsx).
 */

type CapturedProps = Record<string, unknown> & {
  visible: boolean;
  onClose: () => void;
};
let lastProps: CapturedProps | null = null;

jest.mock("@/ui/presenters/ProfileDrawerPresenter", () => ({
  ProfileDrawerPresenter: (props: CapturedProps) => {
    lastProps = props;
    return null;
  },
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (p: string) => mockPush(p) },
}));

const mockSwitchMode = jest.fn();
jest.mock("@/ui/hooks/useModeSwitch", () => ({
  useModeSwitch: () => ({ switchMode: mockSwitchMode }),
}));

const mockSignOut = jest.fn().mockResolvedValue(undefined);
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

let mockProfilePayload: unknown = {
  profile: {
    fullName: "Bradley Evans",
    email: "brad@example.com",
    dateOfBirth: "1990-01-15",
    weightKg: 79.8,
  },
};
let mockProfileError: unknown = null;
let mockProfileRefreshing = false;
let mockProfileAutoRetrying = false;
const mockProfileRefresh = jest.fn();
jest.mock("@/ui/hooks/useProfilePage", () => ({
  useProfilePage: () => ({
    payload: mockProfilePayload,
    error: mockProfileError,
    isRefreshing: mockProfileRefreshing,
    isAutoRetrying: mockProfileAutoRetrying,
    refresh: mockProfileRefresh,
  }),
}));

let mockSubscription: unknown = {
  tierName: "premium",
  trialEndsAt: null,
  expiresAt: "2026-06-01T00:00:00.000Z",
  tierDescription: "Unlimited workouts · AI coach · Macros",
  tierDisplayName: "Premium",
};
const mockRefetchSubscription = jest.fn();
jest.mock("@/ui/hooks/useMySubscription", () => ({
  useMySubscription: () => ({
    data: mockSubscription,
    refetch: mockRefetchSubscription,
  }),
}));

const mockRefresh = jest.fn();
let mockHealth = {
  isAvailable: true,
  permissionStatus: { steps: "granted", bodyWeight: "not_determined" },
  refresh: mockRefresh,
};
jest.mock("@/ui/hooks/useHealthData", () => ({
  useHealthData: () => mockHealth,
}));

let mockAchievementsData: unknown[] | null = null;
const mockRefreshAchievements = jest.fn();
jest.mock("@/ui/hooks/useGetAchievements", () => ({
  useGetAchievements: () => ({
    data: mockAchievementsData,
    refresh: mockRefreshAchievements,
  }),
}));

// eslint-disable-next-line import/first
import { useDrawer } from "@/state/drawer";
// eslint-disable-next-line import/first
import { useHealthSync } from "@/state/health-sync";
// eslint-disable-next-line import/first
import { useUserMode } from "@/state/user-mode";
// eslint-disable-next-line import/first
import { ProfileDrawerContainer } from "@/ui/containers/ProfileDrawerContainer";

beforeEach(() => {
  lastProps = null;
  mockPush.mockClear();
  mockSwitchMode.mockClear();
  mockSignOut.mockClear();
  mockRefresh.mockClear();
  mockRefetchSubscription.mockClear();
  mockRefreshAchievements.mockClear();
  mockProfileRefresh.mockClear();
  mockProfileError = null;
  mockProfileRefreshing = false;
  mockProfileAutoRetrying = false;
  // Reset cross-screen health grant signal + drawer/mode state.
  useHealthSync.setState({ revision: 0 });
  useDrawer.setState({ open: false });
  useUserMode.setState({ mode: "athlete", isTrainerEligible: false });
  // Restore the default granted health mock (some tests reassign it).
  mockHealth = {
    isAvailable: true,
    permissionStatus: { steps: "granted", bodyWeight: "not_determined" },
    refresh: mockRefresh,
  };
  mockAchievementsData = null;
});

describe("ProfileDrawerContainer", () => {
  it("drives the presenter's visible prop from useDrawer().open", () => {
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.visible).toBe(false);

    act(() => {
      useDrawer.setState({ open: true });
    });
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.visible).toBe(true);
  });

  it("maps the live profile payload (name/email/initials/age/weight)", () => {
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.profile).toMatchObject({
      name: "Bradley Evans",
      email: "brad@example.com",
      initials: "BE",
      weightKg: 79.8,
    });
    // age is derived from dateOfBirth (a number, not stored).
    expect(typeof (lastProps?.profile as { age: unknown }).age).toBe("number");
  });

  it("maps the live subscription (tier/inTrial/expiresAt/description)", () => {
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.subscription).toMatchObject({
      tier: "premium",
      inTrial: false,
      planDescription: "Unlimited workouts · AI coach · Macros",
    });
    expect(
      (lastProps?.subscription as { expiresAt: Date }).expiresAt,
    ).toBeInstanceOf(Date);
  });

  it("derives healthConnected from granted permissions", () => {
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.healthConnected).toBe(true);
  });

  it("forwards mode + eligibility from useUserMode", () => {
    useUserMode.setState({ mode: "coach", isTrainerEligible: true });
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.mode).toBe("coach");
    expect(lastProps?.isTrainerEligible).toBe(true);
  });

  it("derives achievementsCount from useGetAchievements; stubs clientCount (10 not shipped)", () => {
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.achievementsCount).toBeUndefined();
    expect(lastProps?.clientCount).toBeUndefined();

    mockAchievementsData = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.achievementsCount).toBe(3);
  });

  it("each row handler closes the drawer then pushes its route", () => {
    useDrawer.setState({ open: true });
    renderWithTheme(<ProfileDrawerContainer />);

    const cases: [string, string][] = [
      ["onOpenProfile", "/(app)/profile/edit"],
      ["onOpenAchievements", "/(app)/achievements"],
      ["onOpenHealth", "/(app)/profile/health"],
      ["onOpenSubscription", "/(auth)/subscription-selection"],
      ["onOpenNotifications", "/(app)/profile/notifications"],
      ["onOpenSettings", "/(app)/profile/privacy-settings"],
    ];

    for (const [handler, route] of cases) {
      act(() => {
        useDrawer.setState({ open: true });
      });
      mockPush.mockClear();
      act(() => {
        (lastProps?.[handler] as () => void)();
      });
      expect(useDrawer.getState().open).toBe(false);
      expect(mockPush).toHaveBeenCalledWith(route);
    }
  });

  it("onSwitchMode delegates to useModeSwitch().switchMode", () => {
    renderWithTheme(<ProfileDrawerContainer />);
    act(() => {
      (lastProps?.onSwitchMode as (n: string) => void)("coach");
    });
    expect(mockSwitchMode).toHaveBeenCalledWith("coach");
  });

  it("onSignOut calls useAuth().signOut", async () => {
    renderWithTheme(<ProfileDrawerContainer />);
    await act(async () => {
      await (lastProps?.onSignOut as () => Promise<void>)();
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("passes profile=undefined while the cache hasn't resolved", () => {
    mockProfilePayload = undefined;
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.profile).toBeUndefined();
    // restore for other tests
    mockProfilePayload = {
      profile: {
        fullName: "Bradley Evans",
        email: "brad@example.com",
        dateOfBirth: "1990-01-15",
        weightKg: 79.8,
      },
    };
  });

  it("flags profileErrored only when the fetch failed with an empty cache and no retry in flight (QA-9)", () => {
    // Errored empty state: no payload, an error, and auto-retry exhausted.
    mockProfilePayload = null;
    mockProfileError = { kind: "api", code: "server", message: "boom" };
    mockProfileRefreshing = false;
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.profileErrored).toBe(true);

    // Still retrying (isRefreshing) → keep the loader, not the error.
    mockProfileRefreshing = true;
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.profileErrored).toBe(false);

    // In a backoff gap between auto-retries (not refreshing, but auto-retry
    // still active) → hold the loader; the error card must not flash in.
    mockProfileRefreshing = false;
    mockProfileAutoRetrying = true;
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.profileErrored).toBe(false);
    mockProfileAutoRetrying = false;

    // Error but a cached payload exists → render the profile, never the error.
    mockProfilePayload = {
      profile: { fullName: "Bradley Evans", email: "brad@example.com" },
    };
    mockProfileRefreshing = false;
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.profileErrored).toBe(false);

    mockProfileError = null;
    mockProfilePayload = {
      profile: {
        fullName: "Bradley Evans",
        email: "brad@example.com",
        dateOfBirth: "1990-01-15",
        weightKg: 79.8,
      },
    };
  });

  it("onRetryProfile delegates to useProfilePage().refresh (QA-9)", () => {
    renderWithTheme(<ProfileDrawerContainer />);
    act(() => {
      (lastProps?.onRetryProfile as () => void)();
    });
    expect(mockProfileRefresh).toHaveBeenCalledTimes(1);
  });

  it("maps null profile fields to safe fallbacks", () => {
    mockProfilePayload = {
      profile: {
        fullName: null,
        email: null,
        dateOfBirth: null,
        weightKg: null,
      },
    };
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.profile).toMatchObject({
      name: "",
      email: "",
      initials: "–",
      age: null,
      weightKg: undefined,
    });
    mockProfilePayload = {
      profile: {
        fullName: "Bradley Evans",
        email: "brad@example.com",
        dateOfBirth: "1990-01-15",
        weightKg: 79.8,
      },
    };
  });

  it("derives inTrial=true from a future trialEndsAt + no expiry", () => {
    mockSubscription = {
      tierName: "premium",
      trialEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
      expiresAt: null,
      tierDescription: null,
      tierDisplayName: "Premium",
    };
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.subscription).toMatchObject({
      inTrial: true,
      // tierDescription null → falls back to tierDisplayName.
      planDescription: "Premium",
    });
    expect(
      (lastProps?.subscription as { expiresAt?: Date }).expiresAt,
    ).toBeUndefined();
    mockSubscription = {
      tierName: "premium",
      trialEndsAt: null,
      expiresAt: "2026-06-01T00:00:00.000Z",
      tierDescription: "Unlimited workouts · AI coach · Macros",
      tierDisplayName: "Premium",
    };
  });

  it("passes subscription=undefined while it hasn't resolved", () => {
    mockSubscription = undefined;
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.subscription).toBeUndefined();
    mockSubscription = {
      tierName: "premium",
      trialEndsAt: null,
      expiresAt: "2026-06-01T00:00:00.000Z",
      tierDescription: "Unlimited workouts · AI coach · Macros",
      tierDisplayName: "Premium",
    };
  });

  it("healthConnected is false when no permission is granted", () => {
    mockHealth = {
      isAvailable: true,
      permissionStatus: { steps: "not_determined", bodyWeight: "denied" },
      refresh: mockRefresh,
    };
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastProps?.healthConnected).toBe(false);
  });

  it("refreshes its health read when a grant bumps useHealthSync", () => {
    renderWithTheme(<ProfileDrawerContainer />);
    // No read on mount — useHealthData's own mount effect already covers it.
    expect(mockRefresh).not.toHaveBeenCalled();
    // A grant on the Health screen bumps the shared signal; the mounted drawer
    // (subscribed to the store) force-refreshes so its badge stops lagging.
    act(() => {
      useHealthSync.getState().markConnected();
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("refetches subscription + achievements when the drawer opens (self-heal a slow/failed cold start)", () => {
    useDrawer.setState({ open: true });
    renderWithTheme(<ProfileDrawerContainer />);
    expect(mockRefetchSubscription).toHaveBeenCalledTimes(1);
    expect(mockRefreshAchievements).toHaveBeenCalledTimes(1);
  });

  it("does not refetch on open while the drawer stays closed", () => {
    useDrawer.setState({ open: false });
    renderWithTheme(<ProfileDrawerContainer />);
    expect(mockRefetchSubscription).not.toHaveBeenCalled();
    expect(mockRefreshAchievements).not.toHaveBeenCalled();
  });

  it("onSignOut swallows a sign-out failure without throwing", async () => {
    mockSignOut.mockRejectedValueOnce(new Error("offline"));
    renderWithTheme(<ProfileDrawerContainer />);
    await act(async () => {
      await (lastProps?.onSignOut as () => Promise<void>)();
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    // Drawer stays open on failure (closeDrawer only runs on success).
  });
});
