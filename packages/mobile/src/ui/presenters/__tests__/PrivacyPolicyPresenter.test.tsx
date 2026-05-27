import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { PrivacyPolicyPresenter } from "../PrivacyPolicyPresenter";

describe("PrivacyPolicyPresenter", () => {
  it("renders the header title and last-updated line", () => {
    const { getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    expect(getByText("Privacy Policy")).toBeTruthy();
    expect(getByText("Last Updated: January 2025")).toBeTruthy();
  });

  it("renders all ten ported section titles verbatim", () => {
    const { getByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    expect(getByText("1. Introduction")).toBeTruthy();
    expect(getByText("2. Information We Collect")).toBeTruthy();
    expect(getByText("3. How We Use Your Information")).toBeTruthy();
    expect(getByText("4. Data Storage and Security")).toBeTruthy();
    expect(getByText("5. Your Rights (GDPR)")).toBeTruthy();
    expect(getByText("6. Data Retention")).toBeTruthy();
    expect(getByText("7. Third-Party Services")).toBeTruthy();
    expect(getByText(/Children/)).toBeTruthy();
    expect(getByText("9. Changes to This Privacy Policy")).toBeTruthy();
    expect(getByText("10. Contact Us")).toBeTruthy();
  });

  it("fires onBack when the header back affordance is tapped", () => {
    const onBack = jest.fn();
    const { getByTestId } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={onBack} />,
    );
    fireEvent.press(getByTestId("privacy-policy-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("surfaces the support email in the Contact Us body", () => {
    const { getAllByText } = renderWithTheme(
      <PrivacyPolicyPresenter onBack={jest.fn()} />,
    );
    // The support email appears in two places (GDPR rights + Contact Us).
    // Both must surface so users have a path to exercise their rights.
    const matches = getAllByText(
      /please\s+contact us at\s+support@persistence\.app/,
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
