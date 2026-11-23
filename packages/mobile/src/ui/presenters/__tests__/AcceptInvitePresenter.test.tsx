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
    isOffline: false,
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

  // PER-126: consent moved to the C11j preview; looking a code up needs a
  // connection.
  it("offline: says so and disables Join even with a code", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <AcceptInvitePresenter {...baseProps()} code="AB23CD" isOffline />,
    );
    expect(getByTestId("accept-invite-offline")).toBeTruthy();
    expect(
      getByText("You're offline. Entering a code needs a connection."),
    ).toBeTruthy();
    expect(
      getByTestId("accept-invite-submit").props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("online: no offline note and no consent sheet on this screen", () => {
    const { queryByTestId } = renderWithTheme(
      <AcceptInvitePresenter {...baseProps()} code="AB23CD" />,
    );
    expect(queryByTestId("accept-invite-offline")).toBeNull();
    expect(queryByTestId("accept-invite-consent-sheet")).toBeNull();
  });
});
