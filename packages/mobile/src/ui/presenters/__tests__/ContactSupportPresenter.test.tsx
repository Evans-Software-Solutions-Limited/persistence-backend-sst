import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  ContactSupportPresenter,
  type ContactSupportPresenterProps,
} from "../ContactSupportPresenter";

function makeProps(
  overrides: Partial<ContactSupportPresenterProps> = {},
): ContactSupportPresenterProps {
  return {
    email: "brad@example.com",
    subject: "",
    message: "",
    onSubjectChange: jest.fn(),
    onMessageChange: jest.fn(),
    onSend: jest.fn(),
    onOpenDirectEmail: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  };
}

describe("ContactSupportPresenter", () => {
  it("renders the readonly email field with the supplied address", () => {
    const { getByTestId } = renderWithTheme(
      <ContactSupportPresenter {...makeProps()} />,
    );
    const emailField = getByTestId("contact-support-email");
    expect(emailField.props.value).toBe("brad@example.com");
    expect(emailField.props.editable).toBe(false);
  });

  it("fires onSubjectChange and onMessageChange when the inputs change", () => {
    const onSubjectChange = jest.fn();
    const onMessageChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ContactSupportPresenter
        {...makeProps({ onSubjectChange, onMessageChange })}
      />,
    );
    fireEvent.changeText(getByTestId("contact-support-subject"), "Hello");
    fireEvent.changeText(getByTestId("contact-support-message"), "Help me");
    expect(onSubjectChange).toHaveBeenCalledWith("Hello");
    expect(onMessageChange).toHaveBeenCalledWith("Help me");
  });

  it("fires onSend when the send button is tapped", () => {
    const onSend = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ContactSupportPresenter {...makeProps({ onSend })} />,
    );
    fireEvent.press(getByTestId("contact-support-send"));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("fires onBack when the back button is tapped", () => {
    const onBack = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ContactSupportPresenter {...makeProps({ onBack })} />,
    );
    fireEvent.press(getByTestId("contact-support-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("fires onOpenDirectEmail when the direct email link is tapped", () => {
    const onOpenDirectEmail = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ContactSupportPresenter {...makeProps({ onOpenDirectEmail })} />,
    );
    fireEvent.press(getByTestId("contact-support-direct-email"));
    expect(onOpenDirectEmail).toHaveBeenCalledTimes(1);
  });

  it("renders the direct-email footer copy verbatim", () => {
    const { getByText } = renderWithTheme(
      <ContactSupportPresenter {...makeProps()} />,
    );
    expect(getByText(/You can also reach us directly at/)).toBeTruthy();
    expect(getByText("admin@evans-software-solutions.com")).toBeTruthy();
  });
});
