import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  OFFLINE_PLANS_COPY,
  OnboardingAccountConfirmationPresenter,
  OnboardingOfflinePlansPresenter,
} from "@/ui/presenters/OnboardingPresenter";

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

describe("OnboardingOfflinePlansPresenter", () => {
  it("explains why plans are missing and that earlier setup is safe", () => {
    const { getByText } = renderWithTheme(
      <OnboardingOfflinePlansPresenter
        onFinish={jest.fn()}
        onRetry={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    expect(getByText(OFFLINE_PLANS_COPY.title)).toBeTruthy();
    expect(getByText(OFFLINE_PLANS_COPY.body)).toBeTruthy();
    // The user must be told the journey so far is not lost, and where plans
    // live afterwards — otherwise "finish without a plan" reads as giving up.
    expect(getByText(OFFLINE_PLANS_COPY.hint)).toBeTruthy();
  });

  it("offers finishing without a plan as the primary action", () => {
    const onFinish = jest.fn();
    const { getByTestId } = renderWithTheme(
      <OnboardingOfflinePlansPresenter
        onFinish={onFinish}
        onRetry={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    fireEvent.press(getByTestId("onboarding-offline-plans-finish"));

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("offers a retry for a connection that has come back", () => {
    const onRetry = jest.fn();
    const { getByTestId } = renderWithTheme(
      <OnboardingOfflinePlansPresenter
        onFinish={jest.fn()}
        onRetry={onRetry}
        onBack={jest.fn()}
      />,
    );

    fireEvent.press(getByTestId("onboarding-offline-plans-retry"));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps a Back route so the page is not a dead end", () => {
    const onBack = jest.fn();
    const { getByLabelText } = renderWithTheme(
      <OnboardingOfflinePlansPresenter
        onFinish={jest.fn()}
        onRetry={jest.fn()}
        onBack={onBack}
      />,
    );

    fireEvent.press(getByLabelText("Back"));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
