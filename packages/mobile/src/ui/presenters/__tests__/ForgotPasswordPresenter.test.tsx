import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ForgotPasswordPresenter } from "../ForgotPasswordPresenter";

const defaultProps = {
  email: "",
  onEmailChange: jest.fn(),
  onSubmit: jest.fn(),
  onBackToSignIn: jest.fn(),
  isLoading: false,
  error: null as string | null,
  isSuccess: false,
};

describe("ForgotPasswordPresenter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders screen title", () => {
    const { getByTestId } = renderWithTheme(
      <ForgotPasswordPresenter {...defaultProps} />,
    );
    expect(getByTestId("screen-title")).toBeTruthy();
  });

  it("renders email input in form state", () => {
    const { getByTestId } = renderWithTheme(
      <ForgotPasswordPresenter {...defaultProps} />,
    );
    expect(getByTestId("email")).toBeTruthy();
  });

  it("renders submit button", () => {
    const { getByTestId } = renderWithTheme(
      <ForgotPasswordPresenter {...defaultProps} />,
    );
    expect(getByTestId("submit")).toBeTruthy();
  });

  it("fires onSubmit when submit button pressed", () => {
    const onSubmit = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ForgotPasswordPresenter {...defaultProps} onSubmit={onSubmit} />,
    );
    fireEvent.press(getByTestId("submit"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("fires onBackToSignIn when back link pressed", () => {
    const onBackToSignIn = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ForgotPasswordPresenter
        {...defaultProps}
        onBackToSignIn={onBackToSignIn}
      />,
    );
    fireEvent.press(getByTestId("back-to-sign-in-link"));
    expect(onBackToSignIn).toHaveBeenCalledTimes(1);
  });

  it("displays error message when error is set", () => {
    const { getByTestId } = renderWithTheme(
      <ForgotPasswordPresenter {...defaultProps} error="Network error" />,
    );
    expect(getByTestId("error-message")).toBeTruthy();
  });

  it("shows loading state on submit button", () => {
    const { getByTestId } = renderWithTheme(
      <ForgotPasswordPresenter {...defaultProps} isLoading />,
    );
    expect(getByTestId("submit-spinner")).toBeTruthy();
  });

  it("shows success state with message and back button", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ForgotPasswordPresenter {...defaultProps} isSuccess />,
    );
    expect(getByTestId("success-message")).toBeTruthy();
    expect(getByTestId("back-to-sign-in")).toBeTruthy();
    // Form should not be visible
    expect(queryByTestId("email")).toBeNull();
    expect(queryByTestId("submit")).toBeNull();
  });

  it("fires onBackToSignIn from success state button", () => {
    const onBackToSignIn = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ForgotPasswordPresenter
        {...defaultProps}
        isSuccess
        onBackToSignIn={onBackToSignIn}
      />,
    );
    fireEvent.press(getByTestId("back-to-sign-in"));
    expect(onBackToSignIn).toHaveBeenCalledTimes(1);
  });
});
