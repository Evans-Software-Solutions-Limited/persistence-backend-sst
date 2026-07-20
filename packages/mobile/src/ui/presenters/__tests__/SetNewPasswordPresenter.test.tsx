import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { SetNewPasswordPresenter } from "../SetNewPasswordPresenter";

const defaultProps = {
  password: "",
  confirmPassword: "",
  onPasswordChange: jest.fn(),
  onConfirmPasswordChange: jest.fn(),
  onSubmit: jest.fn(),
  isLoading: false,
  error: null as string | null,
  isSuccess: false,
};

describe("SetNewPasswordPresenter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the title and both password inputs", () => {
    const { getByTestId } = renderWithTheme(
      <SetNewPasswordPresenter {...defaultProps} />,
    );
    expect(getByTestId("screen-title")).toBeTruthy();
    expect(getByTestId("password")).toBeTruthy();
    expect(getByTestId("confirm-password")).toBeTruthy();
  });

  it("fires onSubmit when the button is pressed", () => {
    const onSubmit = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetNewPasswordPresenter {...defaultProps} onSubmit={onSubmit} />,
    );
    fireEvent.press(getByTestId("submit"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("relays password edits to the change handlers", () => {
    const onPasswordChange = jest.fn();
    const onConfirmPasswordChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SetNewPasswordPresenter
        {...defaultProps}
        onPasswordChange={onPasswordChange}
        onConfirmPasswordChange={onConfirmPasswordChange}
      />,
    );
    fireEvent.changeText(getByTestId("password-input"), "hunter2");
    fireEvent.changeText(getByTestId("confirm-password-input"), "hunter2");
    expect(onPasswordChange).toHaveBeenCalledWith("hunter2");
    expect(onConfirmPasswordChange).toHaveBeenCalledWith("hunter2");
  });

  it("displays an error message when error is set", () => {
    const { getByTestId } = renderWithTheme(
      <SetNewPasswordPresenter
        {...defaultProps}
        error="Passwords do not match"
      />,
    );
    expect(getByTestId("error-message")).toBeTruthy();
  });

  it("shows the loading spinner while saving", () => {
    const { getByTestId } = renderWithTheme(
      <SetNewPasswordPresenter {...defaultProps} isLoading />,
    );
    expect(getByTestId("submit-spinner")).toBeTruthy();
  });

  it("shows the success subtitle once the password is updated", () => {
    const { getByText } = renderWithTheme(
      <SetNewPasswordPresenter {...defaultProps} isSuccess />,
    );
    expect(getByText(/signing you in/i)).toBeTruthy();
  });
});
