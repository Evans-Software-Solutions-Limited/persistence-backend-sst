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

  it("warns up-front that deleting the account does NOT cancel an Apple subscription (5.1.1(v))", () => {
    // Apple bills the subscription at the account level; account deletion
    // can't stop it, so the section must tell the user to cancel it in the
    // App Store (mirrors the confirm dialog's notice).
    const { queryByText } = setup();
    expect(queryByText(/active Apple subscription/i)).not.toBeNull();
    expect(queryByText(/Settings → Subscriptions/i)).not.toBeNull();
  });

  it("no longer promises account deletion via support", () => {
    const { queryByText } = setup();
    // The old footer falsely promised "account deletion at any time by
    // contacting support" — reviewers test this. It must be gone.
    expect(queryByText(/account deletion/i)).toBeNull();
    expect(
      queryByText(/Contact support to request a copy of your data\./i),
    ).not.toBeNull();
  });

  it("does not render the delete row while loading", () => {
    const { queryByTestId } = setup({ isLoading: true });
    expect(queryByTestId("privacy-settings-delete-account")).toBeNull();
    expect(queryByTestId("privacy-settings-loader")).not.toBeNull();
  });
});

describe("PrivacySettingsPresenter — Profile Visibility hidden (v1 launch)", () => {
  it("does NOT render the Profile Visibility section or a Public option", () => {
    // v1 removes public discoverability entirely — no discovery UI /
    // moderation yet (Apple Guideline 1.2 de-risk). With no real choice
    // left, the whole section is hidden so there's no path to go public.
    const { queryByTestId, queryByText } = setup({ isProfilePublic: true });
    expect(queryByTestId("privacy-settings-option-public")).toBeNull();
    expect(queryByTestId("privacy-settings-option-private")).toBeNull();
    expect(queryByText("Profile Visibility")).toBeNull();
  });

  it("still renders the Legal + Delete Account sections", () => {
    // Removing the visibility section must leave the App-Store-required
    // Legal links + account-deletion affordance intact.
    const { queryByTestId } = setup();
    expect(queryByTestId("privacy-settings-policy")).not.toBeNull();
    expect(queryByTestId("privacy-settings-terms")).not.toBeNull();
    expect(queryByTestId("privacy-settings-delete-account")).not.toBeNull();
  });
});
