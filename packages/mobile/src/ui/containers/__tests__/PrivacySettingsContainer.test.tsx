import { act, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import type { PrivacySettingsPresenterProps } from "@/ui/presenters/PrivacySettingsPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { PrivacySettingsContainer } from "../PrivacySettingsContainer";
import {
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
}));
jest.mock("@/application/analytics/metaAttribution", () => ({
  denyMetaAttributionConsent: jest.fn(async () => true),
  getMetaAttributionConsent: jest.fn(async () => "denied"),
  grantMetaAttributionConsent: jest.fn(async () => false),
  isMetaAttributionConfigured: jest.fn(() => true),
}));

type AlertButton = { text?: string; onPress?: () => void | Promise<void> };

const deleteAccount = jest.fn(async () => ({
  purgeAfter: "2026-08-12T00:00:00.000Z",
}));

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
    deleteAccount.mockResolvedValue({ purgeAfter: "2026-08-12T00:00:00.000Z" });
    (useAuth as jest.Mock).mockReturnValue({
      session: { userId: "u1" },
      deleteAccount,
    });
    (useAdapters as jest.Mock).mockReturnValue({
      api: { updateProfile: jest.fn() },
      storage: { invalidateProfilePage: jest.fn() },
    });
    (useProfilePage as jest.Mock).mockReturnValue({
      payload: { profile: { isProfilePublic: false } },
    });
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    (getMetaAttributionConsent as jest.Mock).mockResolvedValue("denied");
    (grantMetaAttributionConsent as jest.Mock).mockResolvedValue(false);
    (denyMetaAttributionConsent as jest.Mock).mockResolvedValue(true);
  });

  it("keeps the attribution switch off when ATT/native activation is denied", async () => {
    render(<PrivacySettingsContainer />);
    await act(async () => {
      await mockProbe.props!.onSetMetaAttributionEnabled(true);
    });
    await waitFor(() => {
      expect(mockProbe.props!.metaAttributionEnabled).toBe(false);
    });
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
