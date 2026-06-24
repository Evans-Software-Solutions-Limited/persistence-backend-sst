import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  PrivacySettingsPresenter,
  type PrivacySettingsPresenterProps,
} from "../PrivacySettingsPresenter";

function makeProps(
  overrides: Partial<PrivacySettingsPresenterProps> = {},
): PrivacySettingsPresenterProps {
  return {
    isLoading: false,
    isProfilePublic: false,
    onUpdateVisibility: jest.fn(),
    onBack: jest.fn(),
    onOpenPrivacyPolicy: jest.fn(),
    onOpenTerms: jest.fn(),
    ...overrides,
  };
}

describe("PrivacySettingsPresenter", () => {
  it("renders the loader while isLoading is true and still shows the back button", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <PrivacySettingsPresenter {...makeProps({ isLoading: true })} />,
    );
    expect(getByTestId("privacy-settings-loader")).toBeTruthy();
    expect(getByTestId("privacy-settings-back")).toBeTruthy();
    // Options aren't rendered yet
    expect(queryByTestId("privacy-settings-option-private")).toBeNull();
    expect(queryByTestId("privacy-settings-option-public")).toBeNull();
  });

  it("renders Private + Public options and the Data & Privacy footer", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <PrivacySettingsPresenter {...makeProps()} />,
    );
    expect(getByText("Privacy Settings")).toBeTruthy();
    expect(getByText("Profile Visibility")).toBeTruthy();
    expect(getByTestId("privacy-settings-option-private")).toBeTruthy();
    expect(getByTestId("privacy-settings-option-public")).toBeTruthy();
    // Data & Privacy footer — & rendered as ampersand in RN text.
    expect(getByText(/Your data is stored securely/)).toBeTruthy();
  });

  it("highlights the Private option when isProfilePublic is false", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <PrivacySettingsPresenter {...makeProps({ isProfilePublic: false })} />,
    );
    expect(getByTestId("privacy-settings-check-private")).toBeTruthy();
    expect(queryByTestId("privacy-settings-check-public")).toBeNull();
  });

  it("highlights the Public option when isProfilePublic is true", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <PrivacySettingsPresenter {...makeProps({ isProfilePublic: true })} />,
    );
    expect(getByTestId("privacy-settings-check-public")).toBeTruthy();
    expect(queryByTestId("privacy-settings-check-private")).toBeNull();
  });

  it("fires onUpdateVisibility('public') when the Public row is tapped", () => {
    const onUpdateVisibility = jest.fn();
    const { getByTestId } = renderWithTheme(
      <PrivacySettingsPresenter {...makeProps({ onUpdateVisibility })} />,
    );
    fireEvent.press(getByTestId("privacy-settings-option-public"));
    expect(onUpdateVisibility).toHaveBeenCalledWith("public");
  });

  it("fires onUpdateVisibility('private') when the Private row is tapped", () => {
    const onUpdateVisibility = jest.fn();
    const { getByTestId } = renderWithTheme(
      <PrivacySettingsPresenter
        {...makeProps({ isProfilePublic: true, onUpdateVisibility })}
      />,
    );
    fireEvent.press(getByTestId("privacy-settings-option-private"));
    expect(onUpdateVisibility).toHaveBeenCalledWith("private");
  });

  it("fires onOpenPrivacyPolicy and onOpenTerms from the Legal links", () => {
    const onOpenPrivacyPolicy = jest.fn();
    const onOpenTerms = jest.fn();
    const { getByTestId } = renderWithTheme(
      <PrivacySettingsPresenter
        {...makeProps({ onOpenPrivacyPolicy, onOpenTerms })}
      />,
    );
    fireEvent.press(getByTestId("privacy-settings-policy"));
    expect(onOpenPrivacyPolicy).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId("privacy-settings-terms"));
    expect(onOpenTerms).toHaveBeenCalledTimes(1);
  });

  it("fires onBack from both the loading and loaded states", () => {
    const onBack = jest.fn();
    const { getByTestId, rerender } = renderWithTheme(
      <PrivacySettingsPresenter {...makeProps({ isLoading: true, onBack })} />,
    );
    fireEvent.press(getByTestId("privacy-settings-back"));
    expect(onBack).toHaveBeenCalledTimes(1);

    rerender(
      <PrivacySettingsPresenter {...makeProps({ isLoading: false, onBack })} />,
    );
    fireEvent.press(getByTestId("privacy-settings-back"));
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});
