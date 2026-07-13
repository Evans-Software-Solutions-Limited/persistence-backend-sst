import { fireEvent, renderWithTheme } from "../../../../__tests__/test-utils";
import {
  AddClientSheetPresenter,
  buildAcceptInviteDeepLink,
  formatCodeExpiry,
} from "../AddClientSheetPresenter";

function baseProps() {
  return {
    visible: true,
    mode: "email" as const,
    onModeChange: jest.fn(),
    email: "",
    reason: "",
    emailError: "",
    isLoading: false,
    onEmailChange: jest.fn(),
    onReasonChange: jest.fn(),
    onInvite: jest.fn(),
    inviteCode: null,
    isGeneratingCode: false,
    isOnline: true,
    onGenerateCode: jest.fn(),
    onShareCode: jest.fn(),
    onCopyCode: jest.fn(),
    justCopied: false,
    onClose: jest.fn(),
  };
}

describe("AddClientSheetPresenter", () => {
  it("renders the title, subtitle, and both fields", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <AddClientSheetPresenter {...baseProps()} />,
    );
    expect(getByText("Invite New Client")).toBeTruthy();
    expect(getByText("Send an invitation to a client by email")).toBeTruthy();
    expect(getByTestId("add-client-email-input")).toBeTruthy();
    expect(getByTestId("add-client-reason-input")).toBeTruthy();
  });

  it("disables Send when the email is empty", () => {
    const { getByTestId } = renderWithTheme(
      <AddClientSheetPresenter {...baseProps()} email="" />,
    );
    expect(
      getByTestId("add-client-send").props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("enables Send once an email is typed", () => {
    const { getByTestId } = renderWithTheme(
      <AddClientSheetPresenter {...baseProps()} email="a@b.com" />,
    );
    expect(
      getByTestId("add-client-send").props.accessibilityState?.disabled,
    ).toBe(false);
  });

  it("shows the email error when present", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <AddClientSheetPresenter
        {...baseProps()}
        emailError="Email is required"
      />,
    );
    expect(getByTestId("add-client-email-error")).toBeTruthy();
    expect(getByText("Email is required")).toBeTruthy();
  });

  it("raises onEmailChange / onReasonChange / onInvite / onClose", () => {
    const props = baseProps();
    const { getByTestId } = renderWithTheme(
      <AddClientSheetPresenter {...props} email="a@b.com" />,
    );
    fireEvent.changeText(getByTestId("add-client-email-input"), "x@y.com");
    expect(props.onEmailChange).toHaveBeenCalledWith("x@y.com");
    fireEvent.changeText(getByTestId("add-client-reason-input"), "knee rehab");
    expect(props.onReasonChange).toHaveBeenCalledWith("knee rehab");
    fireEvent.press(getByTestId("add-client-send"));
    expect(props.onInvite).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId("add-client-cancel"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("disables Send + Cancel while loading", () => {
    const { getByTestId } = renderWithTheme(
      <AddClientSheetPresenter {...baseProps()} email="a@b.com" isLoading />,
    );
    expect(
      getByTestId("add-client-send").props.accessibilityState?.disabled,
    ).toBe(true);
    expect(
      getByTestId("add-client-cancel").props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("renders the mode toggle with both options", () => {
    const { getByTestId } = renderWithTheme(
      <AddClientSheetPresenter {...baseProps()} />,
    );
    expect(getByTestId("add-client-mode-toggle-option-email")).toBeTruthy();
    expect(getByTestId("add-client-mode-toggle-option-code")).toBeTruthy();
  });

  it("raises onModeChange when the toggle is pressed", () => {
    const props = baseProps();
    const { getByTestId } = renderWithTheme(
      <AddClientSheetPresenter {...props} />,
    );
    fireEvent.press(getByTestId("add-client-mode-toggle-option-code"));
    expect(props.onModeChange).toHaveBeenCalledWith("code");
  });

  it("code mode with no code yet: shows Generate, hides Send, Cancel is full-width", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <AddClientSheetPresenter {...baseProps()} mode="code" />,
    );
    expect(getByTestId("add-client-generate-code")).toBeTruthy();
    expect(queryByTestId("add-client-send")).toBeNull();
    expect(queryByTestId("add-client-code-value")).toBeNull();
    expect(queryByTestId("add-client-code-offline")).toBeNull();
  });

  it("code mode offline: shows the offline note and disables Generate", () => {
    const { getByTestId } = renderWithTheme(
      <AddClientSheetPresenter {...baseProps()} mode="code" isOnline={false} />,
    );
    expect(getByTestId("add-client-code-offline")).toBeTruthy();
    expect(
      getByTestId("add-client-generate-code").props.accessibilityState
        ?.disabled,
    ).toBe(true);
  });

  it("code mode fires onGenerateCode", () => {
    const props = baseProps();
    const { getByTestId } = renderWithTheme(
      <AddClientSheetPresenter {...props} mode="code" />,
    );
    fireEvent.press(getByTestId("add-client-generate-code"));
    expect(props.onGenerateCode).toHaveBeenCalledTimes(1);
  });

  it("code mode with a minted code: shows the code, QR value, expiry, and Share", () => {
    const props = baseProps();
    const { getByTestId, getByText } = renderWithTheme(
      <AddClientSheetPresenter
        {...props}
        mode="code"
        inviteCode={{
          id: "invite-1",
          code: "AB23CD",
          expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
          isExisting: false,
        }}
      />,
    );
    expect(getByText("AB23CD")).toBeTruthy();
    expect(getByTestId("add-client-code-qr")).toBeTruthy();
    expect(getByTestId("add-client-code-expiry")).toBeTruthy();
    fireEvent.press(getByTestId("add-client-share-code"));
    expect(props.onShareCode).toHaveBeenCalledTimes(1);
  });

  it("code mode with a minted code: fires onCopyCode from the copy button", () => {
    const props = baseProps();
    const { getByTestId } = renderWithTheme(
      <AddClientSheetPresenter
        {...props}
        mode="code"
        inviteCode={{
          id: "invite-1",
          code: "AB23CD",
          expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
          isExisting: false,
        }}
      />,
    );
    fireEvent.press(getByTestId("add-client-copy-code"));
    expect(props.onCopyCode).toHaveBeenCalledTimes(1);
  });

  it("shows the transient 'Copied' feedback when justCopied is true", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <AddClientSheetPresenter
        {...baseProps()}
        mode="code"
        justCopied
        inviteCode={{
          id: "invite-1",
          code: "AB23CD",
          expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
          isExisting: false,
        }}
      />,
    );
    expect(getByTestId("add-client-copied")).toBeTruthy();
    expect(getByText("Copied")).toBeTruthy();
  });

  it("omits the 'Copied' feedback when justCopied is false", () => {
    const { queryByTestId } = renderWithTheme(
      <AddClientSheetPresenter
        {...baseProps()}
        mode="code"
        inviteCode={{
          id: "invite-1",
          code: "AB23CD",
          expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
          isExisting: false,
        }}
      />,
    );
    expect(queryByTestId("add-client-copied")).toBeNull();
  });
});

describe("buildAcceptInviteDeepLink", () => {
  it("builds the accept-invite deep link via Linking.createURL with the code as a query param", () => {
    expect(buildAcceptInviteDeepLink("AB23CD")).toBe(
      "persistencemobile:///accept-invite?code=AB23CD",
    );
  });
});

describe("formatCodeExpiry", () => {
  const NOW = Date.parse("2026-07-11T12:00:00.000Z");

  it("shows whole hours remaining, rounding up", () => {
    expect(formatCodeExpiry("2026-07-12T11:30:00.000Z", NOW)).toBe(
      "Expires in 24h",
    );
  });

  it("shows minutes under an hour", () => {
    expect(formatCodeExpiry("2026-07-11T12:30:00.000Z", NOW)).toBe(
      "Expires in 30m",
    );
  });

  it("returns Expired once the expiry has passed", () => {
    expect(formatCodeExpiry("2026-07-11T11:00:00.000Z", NOW)).toBe("Expired");
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(formatCodeExpiry("not-a-date", NOW)).toBe("");
  });
});
