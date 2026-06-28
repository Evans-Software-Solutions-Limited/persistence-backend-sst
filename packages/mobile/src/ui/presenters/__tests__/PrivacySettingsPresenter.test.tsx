import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  PrivacySettingsPresenter,
  type PrivacySettingsPresenterProps,
} from "../PrivacySettingsPresenter";

function setup(overrides: Partial<PrivacySettingsPresenterProps> = {}) {
  const props: PrivacySettingsPresenterProps = {
    isLoading: false,
    isProfilePublic: false,
    onUpdateVisibility: jest.fn(),
    onBack: jest.fn(),
    onOpenPrivacyPolicy: jest.fn(),
    onOpenTerms: jest.fn(),
    onDeleteAccount: jest.fn(),
    ...overrides,
  };
  return { props, ...renderWithTheme(<PrivacySettingsPresenter {...props} />) };
}

describe("PrivacySettingsPresenter — account deletion (Apple 5.1.1(v))", () => {
  it("renders a destructive Delete Account row that fires onDeleteAccount", () => {
    const { props, getByTestId } = setup();
    fireEvent.press(getByTestId("privacy-settings-delete-account"));
    expect(props.onDeleteAccount).toHaveBeenCalledTimes(1);
  });

  it("no longer promises account deletion via support", () => {
    const { queryByText } = setup();
    // The old footer falsely promised "account deletion at any time by
    // contacting support" — reviewers test this. It must be gone.
    expect(queryByText(/account deletion/i)).toBeNull();
    expect(queryByText(/Contact support to request a copy of your data\./i)).not.toBeNull();
  });

  it("does not render the delete row while loading", () => {
    const { queryByTestId } = setup({ isLoading: true });
    expect(queryByTestId("privacy-settings-delete-account")).toBeNull();
    expect(queryByTestId("privacy-settings-loader")).not.toBeNull();
  });
});
