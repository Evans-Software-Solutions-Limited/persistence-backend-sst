import { renderWithTheme, fireEvent } from "../../../../__tests__/test-utils";
import { Input } from "../Input";

describe("Input", () => {
  it("renders with label", () => {
    const { getByText } = renderWithTheme(
      <Input label="Email" testID="email" />,
    );
    expect(getByText("Email")).toBeTruthy();
  });

  it("renders with placeholder", () => {
    const { getByTestId } = renderWithTheme(
      <Input placeholder="Enter email" testID="email" />,
    );
    expect(getByTestId("email-input").props.placeholder).toBe("Enter email");
  });

  it("calls onChangeText when text changes", () => {
    const onChangeText = jest.fn();
    const { getByTestId } = renderWithTheme(
      <Input onChangeText={onChangeText} testID="input" />,
    );
    fireEvent.changeText(getByTestId("input-input"), "hello");
    expect(onChangeText).toHaveBeenCalledWith("hello");
  });

  it("displays error message", () => {
    const { getByText } = renderWithTheme(
      <Input error="Required field" testID="input" />,
    );
    expect(getByText("Required field")).toBeTruthy();
  });

  it("displays helper text", () => {
    const { getByText } = renderWithTheme(
      <Input helperText="Enter your email" testID="input" />,
    );
    expect(getByText("Enter your email")).toBeTruthy();
  });

  it("renders disabled state", () => {
    const { getByTestId } = renderWithTheme(
      <Input isDisabled testID="input" />,
    );
    expect(getByTestId("input-input").props.editable).toBe(false);
  });

  it("renders with secure text entry", () => {
    const { getByTestId } = renderWithTheme(
      <Input secureTextEntry testID="password" />,
    );
    expect(getByTestId("password-input").props.secureTextEntry).toBe(true);
  });

  it("reveals and re-hides a password without changing its value", () => {
    const { getByTestId, getByLabelText } = renderWithTheme(
      <Input
        secureTextEntry
        showPasswordToggle
        value="pass word"
        testID="password"
      />,
    );
    const input = getByTestId("password-input");
    expect(input.props.secureTextEntry).toBe(true);

    fireEvent.press(getByLabelText("Show password"));
    expect(getByTestId("password-input").props.secureTextEntry).toBe(false);
    expect(getByTestId("password-input").props.value).toBe("pass word");

    fireEvent.press(getByLabelText("Hide password"));
    expect(getByTestId("password-input").props.secureTextEntry).toBe(true);
  });

  it("handles focus and blur events", () => {
    const { getByTestId } = renderWithTheme(<Input testID="input" />);
    const input = getByTestId("input-input");
    fireEvent(input, "focus");
    fireEvent(input, "blur");
    expect(input).toBeTruthy();
  });

  it("has accessibility label from label prop", () => {
    const { getByTestId } = renderWithTheme(
      <Input label="Password" testID="password" />,
    );
    expect(getByTestId("password-input").props.accessibilityLabel).toBe(
      "Password",
    );
  });
});
