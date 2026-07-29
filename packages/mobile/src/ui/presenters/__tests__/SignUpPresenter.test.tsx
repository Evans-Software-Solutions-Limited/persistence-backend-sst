import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { SignUpPresenter } from "../SignUpPresenter";

const defaultProps = {
  email: "",
  password: "",
  confirmPassword: "",
  onEmailChange: jest.fn(),
  onPasswordChange: jest.fn(),
  onConfirmPasswordChange: jest.fn(),
  onSubmit: jest.fn(),
  onOAuth: jest.fn(),
  onSignIn: jest.fn(),
  isLoading: false,
  oauthLoading: null as null,
  error: null as string | null,
  confirmationSent: false,
};

describe("SignUpPresenter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders screen title and subtitle", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <SignUpPresenter {...defaultProps} />,
    );
    expect(getByTestId("screen-title")).toBeTruthy();
    expect(getByText("Start tracking your progress")).toBeTruthy();
  });

  it("renders email, password, and confirm password inputs", () => {
    const { getByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} />,
    );
    expect(getByTestId("email")).toBeTruthy();
    expect(getByTestId("password")).toBeTruthy();
    expect(getByTestId("confirm-password")).toBeTruthy();
  });

  it("renders create account button", () => {
    const { getByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} />,
    );
    expect(getByTestId("sign-up")).toBeTruthy();
  });

  it("renders sign-in link", () => {
    const { getByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} />,
    );
    expect(getByTestId("sign-in-link")).toBeTruthy();
  });

  it("fires onSubmit when create account button pressed", () => {
    const onSubmit = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} onSubmit={onSubmit} />,
    );
    fireEvent.press(getByTestId("sign-up"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("fires onOAuth when Google button pressed", () => {
    const onOAuth = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} onOAuth={onOAuth} />,
    );
    fireEvent.press(getByTestId("google-oauth"));
    expect(onOAuth).toHaveBeenCalledWith("google");
  });

  it("fires onOAuth with apple when Apple button pressed", () => {
    const onOAuth = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} onOAuth={onOAuth} />,
    );
    fireEvent.press(getByTestId("apple-oauth"));
    expect(onOAuth).toHaveBeenCalledWith("apple");
  });

  it("fires onSignIn when link pressed", () => {
    const onSignIn = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} onSignIn={onSignIn} />,
    );
    fireEvent.press(getByTestId("sign-in-link"));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("displays error message when error is set", () => {
    const { getByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} error="Email already taken" />,
    );
    expect(getByTestId("error-message")).toBeTruthy();
  });

  it("shows loading state on submit button", () => {
    const { getByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} isLoading />,
    );
    expect(getByTestId("sign-up-spinner")).toBeTruthy();
  });

  // The dead-end fix: when Supabase silently sends nothing because the address is
  // already taken, this screen must NOT say "check your email".
  it("swaps the copy to sign-in guidance when the email may already exist", () => {
    const { getByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} confirmationSent mayAlreadyExist />,
    );
    const msg = getByTestId("confirmation-message");
    expect(msg).toBeTruthy();
    const text = JSON.stringify(msg.props.children);
    expect(text).toMatch(/already have an account/i);
    expect(text).toMatch(/sign in/i);
    expect(text).toMatch(/30 days/);
    // Deliberately NOT asserting the absence of "check your email": the copy is
    // hedged so it stays true if the already-exists hint misfires (Inspector
    // Brad). What must be gone is the UNCONDITIONAL promise that an email is on
    // its way — it now only applies "if you've just registered".
    expect(text).toMatch(/if you've just registered/i);
    // The route out is the existing CTA.
    expect(getByTestId("back-to-sign-in")).toBeTruthy();
  });

  it("keeps the check-your-email copy for a genuine new sign-up", () => {
    const { getByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} confirmationSent />,
    );
    const text = JSON.stringify(
      getByTestId("confirmation-message").props.children,
    );
    expect(text).toMatch(/Check your email/i);
    expect(text).not.toMatch(/already have an account/i);
  });

  it("shows confirmation message when confirmationSent is true", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <SignUpPresenter {...defaultProps} confirmationSent />,
    );
    expect(getByTestId("confirmation-message")).toBeTruthy();
    expect(getByTestId("back-to-sign-in")).toBeTruthy();
    // Form should be hidden
    expect(queryByTestId("email")).toBeNull();
  });
});
