import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { SignInPresenter } from "../SignInPresenter";

const defaultProps = {
  email: "",
  password: "",
  onEmailChange: jest.fn(),
  onPasswordChange: jest.fn(),
  onSubmit: jest.fn(),
  onOAuth: jest.fn(),
  onForgotPassword: jest.fn(),
  onSignUp: jest.fn(),
  isLoading: false,
  oauthLoading: null as null,
  error: null as string | null,
};

describe("SignInPresenter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders brand title and tagline", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <SignInPresenter {...defaultProps} />,
    );
    expect(getByTestId("brand-title")).toBeTruthy();
    expect(getByText("TRACK. PUSH. REPEAT.")).toBeTruthy();
  });

  it("renders email and password inputs", () => {
    const { getByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} />,
    );
    expect(getByTestId("email")).toBeTruthy();
    expect(getByTestId("password")).toBeTruthy();
  });

  it("renders sign-in button", () => {
    const { getByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} />,
    );
    expect(getByTestId("sign-in")).toBeTruthy();
  });

  it("renders Google OAuth button", () => {
    const { getByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} />,
    );
    expect(getByTestId("google-oauth")).toBeTruthy();
  });

  it("renders forgot password and sign up links", () => {
    const { getByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} />,
    );
    expect(getByTestId("forgot-password-link")).toBeTruthy();
    expect(getByTestId("sign-up-link")).toBeTruthy();
  });

  it("fires onSubmit when sign-in button pressed", () => {
    const onSubmit = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} onSubmit={onSubmit} />,
    );
    fireEvent.press(getByTestId("sign-in"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("fires onOAuth when Google button pressed", () => {
    const onOAuth = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} onOAuth={onOAuth} />,
    );
    fireEvent.press(getByTestId("google-oauth"));
    expect(onOAuth).toHaveBeenCalledWith("google");
  });

  it("fires onForgotPassword when link pressed", () => {
    const onForgotPassword = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} onForgotPassword={onForgotPassword} />,
    );
    fireEvent.press(getByTestId("forgot-password-link"));
    expect(onForgotPassword).toHaveBeenCalledTimes(1);
  });

  it("fires onSignUp when link pressed", () => {
    const onSignUp = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} onSignUp={onSignUp} />,
    );
    fireEvent.press(getByTestId("sign-up-link"));
    expect(onSignUp).toHaveBeenCalledTimes(1);
  });

  it("displays error message when error is set", () => {
    const { getByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} error="Invalid credentials" />,
    );
    expect(getByTestId("error-message")).toBeTruthy();
  });

  it("does not display error when error is null", () => {
    const { queryByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} error={null} />,
    );
    expect(queryByTestId("error-message")).toBeNull();
  });

  it("shows loading state on sign-in button", () => {
    const { getByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} isLoading />,
    );
    expect(getByTestId("sign-in-spinner")).toBeTruthy();
  });

  it("fires onOAuth with apple when Apple button pressed", () => {
    const onOAuth = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SignInPresenter {...defaultProps} onOAuth={onOAuth} />,
    );
    // NOT fireEvent.press: RNTL resolves a synthetic press by walking up to the
    // outermost `onPress`, which here is this test's own prop on
    // <AppleSignInButton> — so the assertion passes even if the component never
    // wires anything to Apple's button. Invoking the prop on the button host is
    // what ASAuthorizationAppleIDButton actually does on device.
    getByTestId("apple-oauth").props.onPress();
    expect(onOAuth).toHaveBeenCalledWith("apple");
  });

  it("shows connecting state on OAuth button when loading", () => {
    const { getByText } = renderWithTheme(
      <SignInPresenter {...defaultProps} oauthLoading="google" />,
    );
    expect(getByText("Connecting...")).toBeTruthy();
  });

  it("delegates the Apple row to Apple's own button — no app-drawn label or glyph", () => {
    // App Store Guideline 4 guard. Every other Apple assertion in this suite
    // passes whether the row is Apple's component or a hand-drawn
    // <OAuthButton>, so nothing pinned THIS screen to the compliant one — and
    // the screen is where the rejection actually happened. Reverting to
    // <OAuthButton label="Continue with Apple" icon={"\uF8FF"}> would restore
    // exactly what App Review rejected in build 1.0 (39).
    const { queryByText, toJSON } = renderWithTheme(
      <SignInPresenter {...defaultProps} />,
    );
    expect(queryByText("Continue with Apple")).toBeNull();
    expect(JSON.stringify(toJSON())).not.toContain("\uF8FF");
    // The Google button beside it IS still app-drawn, which proves the two
    // assertions above are specific to the Apple row rather than vacuous.
    expect(queryByText("Continue with Google")).toBeTruthy();
  });
});
