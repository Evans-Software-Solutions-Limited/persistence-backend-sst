import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { useAddClientSheet } from "@/state/add-client-sheet";
import {
  AddClientSheetContainer,
  validateInviteEmail,
} from "../AddClientSheetContainer";

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => true),
}));

describe("validateInviteEmail", () => {
  it("requires an email", () => {
    expect(validateInviteEmail("")).toBe("Email is required");
    expect(validateInviteEmail("   ")).toBe("Email is required");
  });
  it("rejects a malformed email", () => {
    expect(validateInviteEmail("nope")).toBe(
      "Please enter a valid email address",
    );
  });
  it("accepts a valid email (trimmed)", () => {
    expect(validateInviteEmail("  a@b.com ")).toBeNull();
  });
});

const USER = "trainer-1";

function makeAdapters(): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
  netInfo: InMemoryNetInfoAdapter;
} {
  const api = new InMemoryApiAdapter();
  const netInfo = new InMemoryNetInfoAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "coach@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    netInfo,
    adapters: {
      api,
      auth,
      storage: new InMemoryStorageAdapter(),
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo,
    },
  };
}

/** Fire the most recent Alert's first button (the "OK" success handler). */
function pressAlertOk(alertSpy: jest.SpyInstance) {
  const lastCall = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const buttons = lastCall[2] as { text: string; onPress?: () => void }[];
  buttons?.[0]?.onPress?.();
}

describe("AddClientSheetContainer", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    useAddClientSheet.setState({ open: true, onInvited: null });
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });
  afterEach(() => {
    alertSpy.mockRestore();
  });

  function renderSheet(_api: InMemoryApiAdapter, adapters: Adapters) {
    return renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <AddClientSheetContainer />
      </AdapterProvider>,
    );
  }

  it("keeps Send disabled (no invite) until an email is entered", async () => {
    const { adapters, api } = makeAdapters();
    const { getByTestId } = renderSheet(api, adapters);
    // Whitespace-only trims to empty → Send stays disabled, no invite fires.
    fireEvent.changeText(getByTestId("add-client-email-input"), "   ");
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(
      getByTestId("add-client-send").props.accessibilityState?.disabled,
    ).toBe(true);
    expect(api.inviteClientCalls).toHaveLength(0);
  });

  it("validates the email format", async () => {
    const { adapters, api } = makeAdapters();
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.changeText(getByTestId("add-client-email-input"), "not-an-email");
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(getByTestId("add-client-email-error").props.children).toBe(
      "Please enter a valid email address",
    );
    expect(api.inviteClientCalls).toHaveLength(0);
  });

  it("relationship_created → success alert, refetch, onInvited, close", async () => {
    const { adapters, api } = makeAdapters();
    const onInvited = jest.fn();
    useAddClientSheet.setState({ open: true, onInvited });
    api.nextInviteResult = {
      success: true,
      action: "relationship_created",
      clientName: "Jane Doe",
      message: "ok",
    };
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.changeText(getByTestId("add-client-email-input"), "jane@doe.com");
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(api.inviteClientCalls[0].clientEmail).toBe("jane@doe.com");
    expect(alertSpy).toHaveBeenCalledWith(
      "Invitation Sent",
      "Training request sent to Jane Doe",
      expect.any(Array),
    );
    act(() => pressAlertOk(alertSpy));
    await waitFor(() => expect(onInvited).toHaveBeenCalledTimes(1));
    expect(useAddClientSheet.getState().open).toBe(false);
  });

  it("forwards a non-empty reason to the invite call", async () => {
    const { adapters, api } = makeAdapters();
    api.nextInviteResult = {
      success: true,
      action: "relationship_created",
      clientName: "Jane",
      message: "ok",
    };
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.changeText(getByTestId("add-client-email-input"), "jane@doe.com");
    fireEvent.changeText(
      getByTestId("add-client-reason-input"),
      "  Knee rehab  ",
    );
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(api.inviteClientCalls[0].relationshipReason).toBe("Knee rehab");
  });

  it("relationship_created without a clientName falls back to the email", async () => {
    const { adapters, api } = makeAdapters();
    api.nextInviteResult = {
      success: true,
      action: "relationship_created",
      clientName: null,
      clientEmail: "nameless@x.com",
      message: "ok",
    };
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.changeText(
      getByTestId("add-client-email-input"),
      "nameless@x.com",
    );
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(alertSpy).toHaveBeenCalledWith(
      "Invitation Sent",
      "Training request sent to nameless@x.com",
      expect.any(Array),
    );
  });

  it("invitation_created → email-pending alert", async () => {
    const { adapters, api } = makeAdapters();
    api.nextInviteResult = {
      success: true,
      action: "invitation_created",
      clientEmail: "new@user.com",
      message: "ok",
    };
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.changeText(getByTestId("add-client-email-input"), "new@user.com");
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(alertSpy).toHaveBeenCalledWith(
      "Invitation Created",
      "Invitation will be sent when new@user.com signs up",
      expect.any(Array),
    );
  });

  it("exists error → inline email error", async () => {
    const { adapters, api } = makeAdapters();
    api.nextInviteError = { code: "exists", message: "dup" };
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.changeText(getByTestId("add-client-email-input"), "dup@x.com");
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(getByTestId("add-client-email-error").props.children).toBe(
      "A relationship with this client already exists",
    );
  });

  it("no_slots error → upgrade alert", async () => {
    const { adapters, api } = makeAdapters();
    api.nextInviteError = { code: "no_slots", message: "full" };
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.changeText(getByTestId("add-client-email-input"), "x@y.com");
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(alertSpy).toHaveBeenCalledWith(
      "No Available Slots",
      "You have reached your client limit. Please upgrade your subscription.",
    );
  });

  it("entitlement 402 (at cap) → no-seats alert, not the generic error", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    api.failError = {
      kind: "api",
      code: "entitlement_denied",
      message: "Subscription does not include this feature",
    };
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.changeText(getByTestId("add-client-email-input"), "x@y.com");
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(alertSpy).toHaveBeenCalledWith(
      "No client seats available",
      "Remove a client or change your subscription to invite more.",
    );
  });

  it("self_invite error → inline email error", async () => {
    const { adapters, api } = makeAdapters();
    api.nextInviteError = { code: "self_invite", message: "self" };
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.changeText(
      getByTestId("add-client-email-input"),
      "coach@example.com",
    );
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(getByTestId("add-client-email-error").props.children).toBe(
      "You cannot invite yourself",
    );
  });

  it("generic failure → generic alert", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true; // failError has no inviteCode
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.changeText(getByTestId("add-client-email-input"), "x@y.com");
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(alertSpy).toHaveBeenCalledWith(
      "Error",
      expect.stringContaining("Test error"),
    );
  });

  it("generic failure with an empty message → fallback copy", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    api.failError = { kind: "api", code: "server", message: "" };
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.changeText(getByTestId("add-client-email-input"), "x@y.com");
    await act(async () => {
      fireEvent.press(getByTestId("add-client-send"));
    });
    expect(alertSpy).toHaveBeenCalledWith(
      "Error",
      "Failed to send invitation. Please try again.",
    );
  });

  it("Cancel closes the sheet", () => {
    const { adapters, api } = makeAdapters();
    const { getByTestId } = renderSheet(api, adapters);
    fireEvent.press(getByTestId("add-client-cancel"));
    expect(useAddClientSheet.getState().open).toBe(false);
  });

  describe("Share code (Coach Mode Phase 8 — invite/QR)", () => {
    it("toggling to Share code renders the Generate button, not the email form", () => {
      const { adapters, api } = makeAdapters();
      const { getByTestId, queryByTestId } = renderSheet(api, adapters);
      fireEvent.press(getByTestId("add-client-mode-toggle-option-code"));
      expect(getByTestId("add-client-generate-code")).toBeTruthy();
      expect(queryByTestId("add-client-email-input")).toBeNull();
    });

    it("generating a code shows the code + QR value = the accept-invite deep link", async () => {
      const { adapters, api } = makeAdapters();
      api.nextInviteCode = {
        id: "invite-1",
        code: "AB23CD",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        isExisting: false,
      };
      const { getByTestId, getByText } = renderSheet(api, adapters);
      fireEvent.press(getByTestId("add-client-mode-toggle-option-code"));
      await act(async () => {
        fireEvent.press(getByTestId("add-client-generate-code"));
      });
      expect(api.createInviteCodeCalls).toBe(1);
      expect(getByText("AB23CD")).toBeTruthy();
      expect(getByTestId("add-client-code-qr").props.children.props.value).toBe(
        "persistencemobile:///accept-invite?code=AB23CD",
      );
    });

    it("Share invokes RN core Share.share with the code + deep link", async () => {
      const shareSpy = jest.spyOn(Share, "share").mockResolvedValue({
        action: Share.sharedAction,
      });
      const { adapters, api } = makeAdapters();
      api.nextInviteCode = {
        id: "invite-1",
        code: "AB23CD",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        isExisting: false,
      };
      const { getByTestId } = renderSheet(api, adapters);
      fireEvent.press(getByTestId("add-client-mode-toggle-option-code"));
      await act(async () => {
        fireEvent.press(getByTestId("add-client-generate-code"));
      });
      fireEvent.press(getByTestId("add-client-share-code"));
      expect(shareSpy).toHaveBeenCalledWith({
        message:
          "Join me on Persistence — use code AB23CD or tap: persistencemobile:///accept-invite?code=AB23CD",
      });
      shareSpy.mockRestore();
    });

    it("Copy calls Clipboard.setStringAsync with the code and shows transient 'Copied' feedback", async () => {
      jest.useFakeTimers();
      const { adapters, api } = makeAdapters();
      api.nextInviteCode = {
        id: "invite-1",
        code: "AB23CD",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        isExisting: false,
      };
      const { getByTestId, queryByTestId } = renderSheet(api, adapters);
      fireEvent.press(getByTestId("add-client-mode-toggle-option-code"));
      await act(async () => {
        fireEvent.press(getByTestId("add-client-generate-code"));
      });
      await act(async () => {
        fireEvent.press(getByTestId("add-client-copy-code"));
      });
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith("AB23CD");
      expect(getByTestId("add-client-copied")).toBeTruthy();

      // The "Copied" feedback resets after the transient window.
      act(() => {
        jest.advanceTimersByTime(1800);
      });
      expect(queryByTestId("add-client-copied")).toBeNull();
      jest.useRealTimers();
    });

    it("offline disables Generate + shows the offline note", async () => {
      const { adapters, api, netInfo } = makeAdapters();
      netInfo.setConnected(false);
      const { getByTestId } = renderSheet(api, adapters);
      fireEvent.press(getByTestId("add-client-mode-toggle-option-code"));
      await waitFor(() =>
        expect(getByTestId("add-client-code-offline")).toBeTruthy(),
      );
      expect(
        getByTestId("add-client-generate-code").props.accessibilityState
          ?.disabled,
      ).toBe(true);
    });

    it("402 (at cap) on generate → the same no-seats alert as the email path", async () => {
      const { adapters, api } = makeAdapters();
      api.nextCreateInviteCodeError = {
        kind: "api",
        code: "entitlement_denied",
        message: "Subscription does not include this feature",
      };
      const { getByTestId } = renderSheet(api, adapters);
      fireEvent.press(getByTestId("add-client-mode-toggle-option-code"));
      await act(async () => {
        fireEvent.press(getByTestId("add-client-generate-code"));
      });
      expect(alertSpy).toHaveBeenCalledWith(
        "No client seats available",
        "Remove a client or change your subscription to invite more.",
      );
    });

    it("resets the mode + generated code when the sheet closes and reopens", async () => {
      const { adapters, api } = makeAdapters();
      api.nextInviteCode = {
        id: "invite-1",
        code: "AB23CD",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        isExisting: false,
      };
      const { getByTestId, queryByTestId, rerender } = renderSheet(
        api,
        adapters,
      );
      fireEvent.press(getByTestId("add-client-mode-toggle-option-code"));
      await act(async () => {
        fireEvent.press(getByTestId("add-client-generate-code"));
      });
      expect(getByTestId("add-client-code-value")).toBeTruthy();

      act(() => {
        useAddClientSheet.setState({ open: false, onInvited: null });
      });
      rerender(
        <AdapterProvider adapters={adapters}>
          <AddClientSheetContainer />
        </AdapterProvider>,
      );
      act(() => {
        useAddClientSheet.setState({ open: true, onInvited: null });
      });
      rerender(
        <AdapterProvider adapters={adapters}>
          <AddClientSheetContainer />
        </AdapterProvider>,
      );
      expect(queryByTestId("add-client-code-value")).toBeNull();
      expect(getByTestId("add-client-email-input")).toBeTruthy();
    });
  });
});
