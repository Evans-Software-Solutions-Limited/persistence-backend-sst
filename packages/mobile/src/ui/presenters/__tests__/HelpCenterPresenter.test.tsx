import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { FAQ_ITEMS, HelpCenterPresenter } from "../HelpCenterPresenter";

describe("HelpCenterPresenter", () => {
  it("renders the header title and FAQ section", () => {
    const { getByText } = renderWithTheme(
      <HelpCenterPresenter onBack={jest.fn()} onContactSupport={jest.fn()} />,
    );
    expect(getByText("Help Center")).toBeTruthy();
    expect(getByText("Frequently Asked Questions")).toBeTruthy();
  });

  it("renders all five FAQ items verbatim", () => {
    expect(FAQ_ITEMS).toHaveLength(5);
    const { getByText, getByTestId } = renderWithTheme(
      <HelpCenterPresenter onBack={jest.fn()} onContactSupport={jest.fn()} />,
    );
    FAQ_ITEMS.forEach((item, index) => {
      expect(getByText(item.question)).toBeTruthy();
      expect(getByText(item.answer)).toBeTruthy();
      expect(getByTestId(`help-center-faq-${index}`)).toBeTruthy();
    });
  });

  it("fires onBack when the back button is tapped", () => {
    const onBack = jest.fn();
    const { getByTestId } = renderWithTheme(
      <HelpCenterPresenter onBack={onBack} onContactSupport={jest.fn()} />,
    );
    fireEvent.press(getByTestId("help-center-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("fires onContactSupport when the Contact Support CTA is tapped", () => {
    const onContactSupport = jest.fn();
    const { getByTestId } = renderWithTheme(
      <HelpCenterPresenter
        onBack={jest.fn()}
        onContactSupport={onContactSupport}
      />,
    );
    fireEvent.press(getByTestId("help-center-contact-support"));
    expect(onContactSupport).toHaveBeenCalledTimes(1);
  });
});
