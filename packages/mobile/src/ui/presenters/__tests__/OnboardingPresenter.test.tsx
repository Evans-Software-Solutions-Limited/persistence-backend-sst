import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { OnboardingAccountConfirmationPresenter } from "@/ui/presenters/OnboardingPresenter";

/**
 * Covers only `OnboardingAccountConfirmationPresenter` — the account-only
 * confirmation page added for WP11 (specs/milestones/MARKETING-PLANS). The
 * rest of `OnboardingPresenter.tsx` (welcome/role/intent) is exercised
 * indirectly through `OnboardingPageContainer.test.tsx`, which mocks this
 * component out; this file tests its actual rendered copy directly.
 */
describe("OnboardingAccountConfirmationPresenter", () => {
  it("renders the tier and a British-formatted expiry date", () => {
    const { getByText } = renderWithTheme(
      <OnboardingAccountConfirmationPresenter
        tierDisplayName="Premium+"
        expiresAt="2026-12-25T00:00:00.000Z"
        onContinue={jest.fn()}
      />,
    );

    expect(
      getByText("Your Premium+ access is active until 25 Dec 2026."),
    ).toBeTruthy();
  });

  it("falls back to a dateless message when there is no expiry", () => {
    const { getByText, queryByText } = renderWithTheme(
      <OnboardingAccountConfirmationPresenter
        tierDisplayName="Coach"
        expiresAt={null}
        onContinue={jest.fn()}
      />,
    );

    expect(getByText("Your Coach access is active.")).toBeTruthy();
    expect(queryByText(/until/)).toBeNull();
  });

  it("calls onContinue when the button is pressed", () => {
    const onContinue = jest.fn();
    const { getByTestId } = renderWithTheme(
      <OnboardingAccountConfirmationPresenter
        tierDisplayName="Premium"
        expiresAt="2026-12-25T00:00:00.000Z"
        onContinue={onContinue}
      />,
    );

    fireEvent.press(getByTestId("onboarding-account-confirmation-continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
