import { fireEvent, renderWithTheme } from "../../../../__tests__/test-utils";
import {
  AcceptInvitePresenter,
  type AcceptInvitePresenterProps,
} from "../AcceptInvitePresenter";

function baseProps(): AcceptInvitePresenterProps {
  return {
    code: "",
    onCodeChange: jest.fn(),
    isSubmitting: false,
    errorMessage: "",
    onSubmit: jest.fn(),
    onBack: jest.fn(),
    consentVisible: false,
    onConsentClose: jest.fn(),
    onConsentConfirm: jest.fn(),
  };
}

describe("AcceptInvitePresenter", () => {
  it("renders the header + code input", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <AcceptInvitePresenter {...baseProps()} />,
    );
    expect(getByText("Enter code")).toBeTruthy();
    expect(getByTestId("accept-invite-code-input")).toBeTruthy();
  });

  it("disables Join when the code is empty", () => {
    const { getByTestId } = renderWithTheme(
      <AcceptInvitePresenter {...baseProps()} code="" />,
    );
    expect(
      getByTestId("accept-invite-submit").props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("enables Join once a code is entered", () => {
    const { getByTestId } = renderWithTheme(
      <AcceptInvitePresenter {...baseProps()} code="AB23CD" />,
    );
    expect(
      getByTestId("accept-invite-submit").props.accessibilityState?.disabled,
    ).toBe(false);
  });

  it("uppercases input via onCodeChange", () => {
    const props = baseProps();
    const { getByTestId } = renderWithTheme(
      <AcceptInvitePresenter {...props} />,
    );
    fireEvent.changeText(getByTestId("accept-invite-code-input"), "ab23cd");
    expect(props.onCodeChange).toHaveBeenCalledWith("AB23CD");
  });

  it("raises onSubmit / onBack", () => {
    const props = baseProps();
    const { getByTestId } = renderWithTheme(
      <AcceptInvitePresenter {...props} code="AB23CD" />,
    );
    fireEvent.press(getByTestId("accept-invite-submit"));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows the inline error message when present", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <AcceptInvitePresenter
        {...baseProps()}
        errorMessage="Invalid or expired code. Ask your coach for a new one."
      />,
    );
    expect(getByTestId("accept-invite-error")).toBeTruthy();
    expect(
      getByText("Invalid or expired code. Ask your coach for a new one."),
    ).toBeTruthy();
  });

  it("disables Join + the input while submitting", () => {
    const { getByTestId } = renderWithTheme(
      <AcceptInvitePresenter {...baseProps()} code="AB23CD" isSubmitting />,
    );
    expect(
      getByTestId("accept-invite-submit").props.accessibilityState?.disabled,
    ).toBe(true);
    expect(getByTestId("accept-invite-code-input").props.editable).toBe(false);
  });

  // 26-coach-data-sharing-consent
  describe("data-sharing consent sheet", () => {
    it("does not render the consent sheet's confirm control until it's opened", () => {
      const { queryByTestId } = renderWithTheme(
        <AcceptInvitePresenter {...baseProps()} consentVisible={false} />,
      );
      expect(queryByTestId("accept-invite-consent-confirm")).toBeNull();
    });

    it("renders the consent sheet with an unticked checkbox and a disabled confirm when open", () => {
      const { getByTestId } = renderWithTheme(
        <AcceptInvitePresenter {...baseProps()} consentVisible />,
      );
      expect(
        getByTestId("accept-invite-consent-checkbox").props.accessibilityState
          ?.checked,
      ).toBe(false);
      expect(
        getByTestId("accept-invite-consent-confirm").props.accessibilityState
          ?.disabled,
      ).toBe(true);
    });

    it("cannot confirm until the checkbox is ticked, then confirms with it ticked", () => {
      const props = { ...baseProps(), consentVisible: true };
      const { getByTestId } = renderWithTheme(
        <AcceptInvitePresenter {...props} />,
      );
      fireEvent.press(getByTestId("accept-invite-consent-confirm"));
      expect(props.onConsentConfirm).not.toHaveBeenCalled();

      fireEvent.press(getByTestId("accept-invite-consent-checkbox"));
      fireEvent.press(getByTestId("accept-invite-consent-confirm"));
      expect(props.onConsentConfirm).toHaveBeenCalledTimes(1);
    });
  });
});
