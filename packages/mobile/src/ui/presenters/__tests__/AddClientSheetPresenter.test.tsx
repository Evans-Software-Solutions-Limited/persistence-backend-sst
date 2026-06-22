import { fireEvent, renderWithTheme } from "../../../../__tests__/test-utils";
import { AddClientSheetPresenter } from "../AddClientSheetPresenter";

function baseProps() {
  return {
    visible: true,
    email: "",
    reason: "",
    emailError: "",
    isLoading: false,
    onEmailChange: jest.fn(),
    onReasonChange: jest.fn(),
    onInvite: jest.fn(),
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
});
