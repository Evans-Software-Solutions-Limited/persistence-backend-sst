import { render, act } from "@testing-library/react-native";
import { Alert } from "react-native";
import type { RestoreAccountPresenterProps } from "@/ui/presenters/RestoreAccountPresenter";
import { useAuth } from "@/ui/hooks/useAuth";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useRestoreAccount } from "@/ui/hooks/useRestoreAccount";
import { usePendingInvite } from "@/state/pending-invite";
import { RestoreAccountContainer } from "../RestoreAccountContainer";

// Capture the props handed to the (mocked) presenter, mirroring
// PrivacySettingsContainer.test.tsx's probe pattern.
const mockProbe: { props: RestoreAccountPresenterProps | null } = {
  props: null,
};
jest.mock("@/ui/presenters/RestoreAccountPresenter", () => ({
  RestoreAccountPresenter: (props: RestoreAccountPresenterProps) => {
    mockProbe.props = props;
    return null;
  },
}));

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@/ui/hooks/useAuth");
jest.mock("@/ui/hooks/useProfilePage");
jest.mock("@/ui/hooks/useRestoreAccount");

const signOut = jest.fn(async () => undefined);
const refresh = jest.fn(async () => undefined);
const mutateAsync = jest.fn(async () => ({ restored: true as const }));

describe("RestoreAccountContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProbe.props = null;
    signOut.mockResolvedValue(undefined);
    refresh.mockResolvedValue(undefined);
    mutateAsync.mockResolvedValue({ restored: true });

    (useAuth as jest.Mock).mockReturnValue({ signOut });
    (useProfilePage as jest.Mock).mockReturnValue({
      payload: { profile: { purgeAfter: "2026-07-31T00:00:00.000Z" } },
      refresh,
    });
    (useRestoreAccount as jest.Mock).mockReturnValue({
      mutateAsync,
      isPending: false,
    });
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  it("passes purgeAfter + isRestoring through to the presenter", () => {
    render(<RestoreAccountContainer />);
    expect(mockProbe.props?.purgeAfter).toBe("2026-07-31T00:00:00.000Z");
    expect(mockProbe.props?.isRestoring).toBe(false);
  });

  it("falls back to null purgeAfter when the profile-page payload hasn't loaded yet", () => {
    (useProfilePage as jest.Mock).mockReturnValue({ payload: null, refresh });
    render(<RestoreAccountContainer />);
    expect(mockProbe.props?.purgeAfter).toBeNull();
  });

  it("restores, refreshes the profile cache, and routes into the tabs on success", async () => {
    render(<RestoreAccountContainer />);
    await act(async () => {
      await mockProbe.props!.onRestore();
    });

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)");
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("redeems a stashed invite code after restore (third consume site, device-QA #2)", async () => {
    usePendingInvite.getState().setPendingCode("AB23CD");
    render(<RestoreAccountContainer />);
    await act(async () => {
      await mockProbe.props!.onRestore();
    });

    expect(mockReplace).toHaveBeenCalledWith(
      "/(app)/accept-invite?code=AB23CD",
    );
    usePendingInvite.getState().reset();
  });

  it("treats a 409 (account wasn't soft-deleted) the same as success", async () => {
    mutateAsync.mockRejectedValueOnce({
      kind: "api",
      code: "server",
      status: 409,
      message: "Account is not scheduled for deletion",
    });
    render(<RestoreAccountContainer />);
    await act(async () => {
      await mockProbe.props!.onRestore();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)");
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("shows an alert and does not proceed on a non-409 failure", async () => {
    mutateAsync.mockRejectedValueOnce({
      kind: "api",
      code: "network",
      message: "offline",
    });
    render(<RestoreAccountContainer />);
    await act(async () => {
      await mockProbe.props!.onRestore();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "Couldn't restore your account",
      "Something went wrong. Please try again.",
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("signs out on onSignOut", async () => {
    render(<RestoreAccountContainer />);
    await act(async () => {
      await mockProbe.props!.onSignOut();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("swallows a signOut failure silently (no alert, no throw)", async () => {
    signOut.mockRejectedValueOnce(new Error("network"));
    render(<RestoreAccountContainer />);
    await act(async () => {
      await mockProbe.props!.onSignOut();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
