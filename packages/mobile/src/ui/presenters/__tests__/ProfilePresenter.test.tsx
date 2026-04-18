import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ProfilePresenter } from "../ProfilePresenter";

function makeProps(
  overrides: Partial<Parameters<typeof ProfilePresenter>[0]> = {},
): Parameters<typeof ProfilePresenter>[0] {
  return {
    email: "lifter@example.com",
    displayName: null,
    avatarUrl: null,
    isSigningOut: false,
    error: null,
    onSignOut: jest.fn(),
    ...overrides,
  };
}

describe("ProfilePresenter", () => {
  it("renders the email as the account detail", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps()} />,
    );
    expect(getByTestId("profile-email").props.children).toBe(
      "lifter@example.com",
    );
  });

  it("falls back to em-dash when email is null", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ email: null })} />,
    );
    expect(getByTestId("profile-email").props.children).toBe("—");
  });

  it("derives two-letter initials from displayName when provided", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({ displayName: "Brad Simms", email: "b@e.com" })}
      />,
    );
    // Avatar uses fallback as accessibilityLabel so we can read it off testID.
    expect(getByTestId("profile-avatar").props.accessibilityLabel).toBe("BS");
  });

  it("derives initials from email username when no displayName", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ email: "jane.doe@example.com" })} />,
    );
    expect(getByTestId("profile-avatar").props.accessibilityLabel).toBe("JD");
  });

  it("falls back to '?' when both email and displayName are missing", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ email: null, displayName: null })} />,
    );
    expect(getByTestId("profile-avatar").props.accessibilityLabel).toBe("?");
  });

  it("uses first two characters of a single-word name", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter
        {...makeProps({ displayName: "Kai", email: "kai@example.com" })}
      />,
    );
    expect(getByTestId("profile-avatar").props.accessibilityLabel).toBe("KA");
  });

  it("calls onSignOut when the button is pressed", () => {
    const onSignOut = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ onSignOut })} />,
    );
    fireEvent.press(getByTestId("sign-out-button"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("renders the error banner when error is set", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ error: "Network down" })} />,
    );
    expect(getByTestId("profile-error")).toBeTruthy();
  });

  it("hides the error banner when error is null", () => {
    const { queryByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ error: null })} />,
    );
    expect(queryByTestId("profile-error")).toBeNull();
  });

  it("renders the button in loading state when isSigningOut is true", () => {
    const { getByTestId } = renderWithTheme(
      <ProfilePresenter {...makeProps({ isSigningOut: true })} />,
    );
    expect(getByTestId("sign-out-button-spinner")).toBeTruthy();
    expect(
      getByTestId("sign-out-button").props.accessibilityState?.disabled,
    ).toBe(true);
  });
});
