import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TermsOfServicePresenter } from "../TermsOfServicePresenter";

describe("TermsOfServicePresenter", () => {
  it("renders the header title and last-updated line", () => {
    const { getByText } = renderWithTheme(
      <TermsOfServicePresenter onBack={jest.fn()} />,
    );
    expect(getByText("Terms of Service")).toBeTruthy();
    expect(getByText("Last Updated: January 2025")).toBeTruthy();
  });

  it("renders all seven ported section titles verbatim", () => {
    const { getByText } = renderWithTheme(
      <TermsOfServicePresenter onBack={jest.fn()} />,
    );
    expect(getByText("1. Acceptance of Terms")).toBeTruthy();
    expect(getByText("2. Use License")).toBeTruthy();
    expect(getByText("3. User Accounts")).toBeTruthy();
    expect(getByText("4. Health and Fitness Disclaimer")).toBeTruthy();
    expect(getByText("5. Limitation of Liability")).toBeTruthy();
    expect(getByText("6. Revisions")).toBeTruthy();
    expect(getByText("7. Contact Information")).toBeTruthy();
  });

  it("fires onBack when the header back affordance is tapped", () => {
    const onBack = jest.fn();
    const { getByTestId } = renderWithTheme(
      <TermsOfServicePresenter onBack={onBack} />,
    );
    fireEvent.press(getByTestId("terms-of-service-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders the Use License sub-list", () => {
    const { getByText } = renderWithTheme(
      <TermsOfServicePresenter onBack={jest.fn()} />,
    );
    expect(getByText("• Modify or copy the materials")).toBeTruthy();
    expect(
      getByText("• Use the materials for any commercial purpose"),
    ).toBeTruthy();
  });
});
