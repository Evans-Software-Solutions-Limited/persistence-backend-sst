import { act, render, waitFor } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import type { PrivacySettingsPresenterProps } from "@/ui/presenters/PrivacySettingsPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { PrivacySettingsContainer } from "../PrivacySettingsContainer";
import {
  canRequestSystemTracking,
  denyMetaAttributionConsent,
  grantMetaAttributionConsent,
  getMetaAttributionConsent,
} from "@/application/analytics/metaAttribution";

// Capture the props handed to the (mocked) presenter so we can drive the
// container's handlers directly. `mock`-prefixed so jest's hoist allows it.
const mockProbe: { props: PrivacySettingsPresenterProps | null } = {
  props: null,
};
jest.mock("@/ui/presenters/PrivacySettingsPresenter", () => ({
  PrivacySettingsPresenter: (props: PrivacySettingsPresenterProps) => {
    mockProbe.props = props;
    return null;
  },
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock("@/ui/hooks/useAdapters");
jest.mock("@/ui/hooks/useAuth");
jest.mock("@/ui/hooks/useProfilePage");
jest.mock("react-native-fbsdk-next", () => ({
  Settings: {
    initializeSDK: jest.fn(),
    setAdvertiserTrackingEnabled: jest.fn(),
    setAdvertiserIDCollectionEnabled: jest.fn(),
    setAutoLogAppEventsEnabled: jest.fn(),
  },
  AppEventsLogger: { logEvent: jest.fn() },
}));
jest.mock("expo-tracking-transparency", () => ({
  requestTrackingPermissionsAsync: jest.fn(),
  getTrackingPermissionsAsync: jest.fn(),
}));
jest.mock("@/application/analytics/metaAttribution", () => ({
  canRequestSystemTracking: jest.fn(async () => true),
  denyMetaAttributionConsent: jest.fn(async () => true),
  getMetaAttributionConsent: jest.fn(async () => "denied"),
  grantMetaAttributionConsent: jest.fn(async () => "declined"),
  isMetaAttributionConfigured: jest.fn(() => true),
}));

type AlertButton = { text?: string; onPress?: () => void | Promise<void> };

const deleteAccount = jest.fn(async () => ({
  purgeAfter: "2026-08-12T00:00:00.000Z",
}));
const getCachedProfilePage = jest.fn();
const cacheProfilePage = jest.fn();
const enqueueMutation = jest.fn();

/** Pull the button list out of the Nth Alert.alert invocation. */
function alertButtons(callIndex: number): AlertButton[] {
  const call = (Alert.alert as jest.Mock).mock.calls[callIndex];
  return (call?.[2] ?? []) as AlertButton[];
}
const pressByText = (buttons: AlertButton[], text: string) =>
  buttons.find((b) => b.text === text)?.onPress?.();

describe("PrivacySettingsContainer — delete account", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProbe.props = null;
    // Explicit defaults. `clearAllMocks` keeps implementations, so a value set
    // by one test leaks forward; and a stale boolean default here would be
    // neither "activated" nor "failed", silently sending any newly added test
    // down the *declined* branch. `jest.Mock` is untyped, so tsc won't catch it.
    (grantMetaAttributionConsent as jest.Mock).mockResolvedValue("declined");
    (canRequestSystemTracking as jest.Mock).mockResolvedValue(true);
    (getMetaAttributionConsent as jest.Mock).mockResolvedValue("denied");
    (denyMetaAttributionConsent as jest.Mock).mockResolvedValue(true);
    deleteAccount.mockResolvedValue({ purgeAfter: "2026-08-12T00:00:00.000Z" });
    (useAuth as jest.Mock).mockReturnValue({
      session: { userId: "u1" },
      deleteAccount,
    });
    (useAdapters as jest.Mock).mockReturnValue({
      api: { updateProfile: jest.fn() },
      storage: {
        invalidateProfilePage: jest.fn(),
        getCachedProfilePage,
        cacheProfilePage,
        enqueueMutation,
        getQueuedEntriesForEntity: jest.fn(() => []),
        updateMutationPayload: jest.fn(),
      },
    });
    (useProfilePage as jest.Mock).mockReturnValue({
      payload: { profile: { isProfilePublic: false } },
    });
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    (getMetaAttributionConsent as jest.Mock).mockResolvedValue("denied");
    (grantMetaAttributionConsent as jest.Mock).mockResolvedValue(false);
    (denyMetaAttributionConsent as jest.Mock).mockResolvedValue(true);
    getCachedProfilePage.mockReturnValue({
      payload: {
        profile: {
          isProfilePublic: false,
          showTemplateWorkouts: true,
        },
      },
    });
  });

  it("keeps the attribution switch off, and stays silent, when the user declines the system dialog", async () => {
    // iOS did present the dialog on this tap, and the user said no.
    (canRequestSystemTracking as jest.Mock).mockResolvedValue(true);
    (grantMetaAttributionConsent as jest.Mock).mockResolvedValue("declined");
    render(<PrivacySettingsContainer />);
    await act(async () => {
      await mockProbe.props!.onSetMetaAttributionEnabled(true);
    });
    await waitFor(() => {
      expect(mockProbe.props!.metaAttributionEnabled).toBe(false);
    });
    // Their answer is their answer — nagging after a decline is the behaviour
    // Guideline 5.1.2(i) exists to prevent.
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("points the user at iOS Settings once ATT can no longer be asked", async () => {
    const openSettings = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue(undefined);
    (canRequestSystemTracking as jest.Mock).mockResolvedValue(false);
    (grantMetaAttributionConsent as jest.Mock).mockResolvedValue("declined");
    render(<PrivacySettingsContainer />);

    await act(async () => {
      await mockProbe.props!.onSetMetaAttributionEnabled(true);
    });

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        "iOS is no longer asking about tracking",
        expect.stringContaining("only once per install"),
        expect.any(Array),
      ),
    );
    expect(mockProbe.props!.metaAttributionEnabled).toBe(false);

    const buttons = (Alert.alert as jest.Mock).mock
      .calls[0][2] as AlertButton[];
    await act(async () => {
      await buttons
        .find(({ text }) => text === "Open iOS Settings")
        ?.onPress?.();
    });
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  // Regression: a granted-then-failed activation used to be indistinguishable
  // from a decline, so it fell silent — and every retry then took the other
  // branch and told the user to allow tracking in Settings where it was
  // already allowed. The outcome is now reported, not inferred.
  it("reports a real failure when ATT was granted but activation failed", async () => {
    (canRequestSystemTracking as jest.Mock).mockResolvedValue(true);
    (grantMetaAttributionConsent as jest.Mock).mockResolvedValue("failed");
    render(<PrivacySettingsContainer />);

    await act(async () => {
      await mockProbe.props!.onSetMetaAttributionEnabled(true);
    });

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        "Couldn't enable advertising measurement",
        "We couldn't safely save that change. Please try again.",
      ),
    );
  });

  it("reports the failure even once ATT can no longer be asked, rather than misdirecting to Settings", async () => {
    (canRequestSystemTracking as jest.Mock).mockResolvedValue(false);
    (grantMetaAttributionConsent as jest.Mock).mockResolvedValue("failed");
    render(<PrivacySettingsContainer />);

    await act(async () => {
      await mockProbe.props!.onSetMetaAttributionEnabled(true);
    });

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        "Couldn't enable advertising measurement",
        expect.any(String),
      ),
    );
    expect(Alert.alert).not.toHaveBeenCalledWith(
      "iOS is no longer asking about tracking",
      expect.any(String),
      expect.any(Array),
    );
  });

  // Guideline 5.1.2(i): nothing the app shows in this flow may read as the app
  // itself asking for permission to track. Build 49 was rejected for exactly
  // that shape — an "Allow…" title with a "Not now" button. This drives EVERY
  // dialog the flow can raise, not just one, so a prompt added to any branch
  // later cannot slip past the one test that exists to prevent a recurrence.
  const assertNoPermissionRequestShape = () => {
    expect(Alert.alert).toHaveBeenCalled();
    for (const [title, , buttons] of (Alert.alert as jest.Mock).mock
      .calls as Array<[string, string, AlertButton[] | undefined]>) {
      expect(title).not.toMatch(/^allow/i);
      for (const { text } of buttons ?? []) {
        expect(text ?? "").not.toMatch(/^(not now|allow)$/i);
      }
    }
  };

  it.each([
    ["declined", false, true],
    ["failed", true, true],
    ["failed", false, true],
  ] as Array<[string, boolean, boolean]>)(
    "never shows a permission-request-shaped dialog (outcome %s, presentable %s)",
    async (outcome, presentable) => {
      (canRequestSystemTracking as jest.Mock).mockResolvedValue(presentable);
      (grantMetaAttributionConsent as jest.Mock).mockResolvedValue(outcome);
      render(<PrivacySettingsContainer />);

      await act(async () => {
        await mockProbe.props!.onSetMetaAttributionEnabled(true);
      });

      await waitFor(assertNoPermissionRequestShape);
    },
  );

  it("never shows a permission-request-shaped dialog when withdrawal fails", async () => {
    (getMetaAttributionConsent as jest.Mock).mockResolvedValue("granted");
    (denyMetaAttributionConsent as jest.Mock).mockResolvedValue(false);
    render(<PrivacySettingsContainer />);
    await waitFor(() =>
      expect(mockProbe.props!.metaAttributionEnabled).toBe(true),
    );

    await act(async () => {
      await mockProbe.props!.onSetMetaAttributionEnabled(false);
    });

    await waitFor(assertNoPermissionRequestShape);
  });

  it("does not consult iOS Settings guidance when activation succeeds", async () => {
    (grantMetaAttributionConsent as jest.Mock).mockResolvedValue("activated");
    (canRequestSystemTracking as jest.Mock).mockResolvedValue(false);
    render(<PrivacySettingsContainer />);

    await act(async () => {
      await mockProbe.props!.onSetMetaAttributionEnabled(true);
    });

    await waitFor(() =>
      expect(mockProbe.props!.metaAttributionEnabled).toBe(true),
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("optimistically persists the template-workout preference", () => {
    render(<PrivacySettingsContainer />);

    act(() => {
      mockProbe.props!.onSetShowTemplateWorkouts(false);
    });

    expect(mockProbe.props!.showTemplateWorkouts).toBe(false);
    expect(cacheProfilePage).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        profile: expect.objectContaining({ showTemplateWorkouts: false }),
      }),
    );
    expect(enqueueMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/profile",
        method: "PATCH",
        payload: { showTemplateWorkouts: false },
      }),
    );
  });

  it("keeps attribution visibly enabled when withdrawal cannot be guaranteed", async () => {
    (getMetaAttributionConsent as jest.Mock).mockResolvedValue("granted");
    (denyMetaAttributionConsent as jest.Mock).mockResolvedValue(false);
    render(<PrivacySettingsContainer />);
    await waitFor(() => {
      expect(mockProbe.props!.metaAttributionEnabled).toBe(true);
    });

    await act(async () => {
      await mockProbe.props!.onSetMetaAttributionEnabled(false);
    });

    await waitFor(() => {
      expect(mockProbe.props!.metaAttributionEnabled).toBe(true);
      expect(Alert.alert).toHaveBeenCalledWith(
        "Couldn't update advertising measurement",
        "We couldn't safely save that change. Please try again.",
      );
    });
  });

  it("double-confirms then calls deleteAccount", async () => {
    render(<PrivacySettingsContainer />);
    mockProbe.props!.onDeleteAccount();

    // First confirm dialog → grace-period wording (Cluster 2b soft-delete),
    // then tap the destructive action.
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [, firstBody] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(firstBody).toContain("scheduled for deletion");
    expect(firstBody).toContain("30 days");
    expect(firstBody).toContain("restore your account by signing in again");
    pressByText(alertButtons(0), "Delete Account");

    // Second (last-chance) dialog → tap Delete.
    expect(Alert.alert).toHaveBeenCalledTimes(2);
    const [, secondBody] = (Alert.alert as jest.Mock).mock.calls[1];
    expect(secondBody).toContain("30 days");
    await pressByText(alertButtons(1), "Delete");

    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it("shows the purge date after a successful deletion", async () => {
    render(<PrivacySettingsContainer />);
    mockProbe.props!.onDeleteAccount();
    pressByText(alertButtons(0), "Delete Account");
    await pressByText(alertButtons(1), "Delete");

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        "Account scheduled for deletion",
        expect.stringContaining("12 August 2026"),
      );
    });
  });

  it("does nothing when the user cancels the first dialog", () => {
    render(<PrivacySettingsContainer />);
    mockProbe.props!.onDeleteAccount();
    pressByText(alertButtons(0), "Cancel");
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("does not delete if the user cancels the second dialog", () => {
    render(<PrivacySettingsContainer />);
    mockProbe.props!.onDeleteAccount();
    pressByText(alertButtons(0), "Delete Account");
    pressByText(alertButtons(1), "Cancel");
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("shows a non-destructive retry alert when deletion fails", async () => {
    deleteAccount.mockRejectedValueOnce(new Error("network"));
    render(<PrivacySettingsContainer />);
    mockProbe.props!.onDeleteAccount();
    pressByText(alertButtons(0), "Delete Account");
    await pressByText(alertButtons(1), "Delete");

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        "Couldn't delete your account",
        "Something went wrong. Please try again.",
      );
    });
  });
});
