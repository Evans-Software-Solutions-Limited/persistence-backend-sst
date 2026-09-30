import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  OFFLINE_PLANS_COPY,
  OnboardingWelcomePresenter,
  OnboardingRolePresenter,
  OnboardingIntentPresenter,
  NUTRITION_ONBOARDING_OPTIONS,
  TRAINING_ONBOARDING_OPTIONS,
  OnboardingAccountConfirmationPresenter,
  OnboardingOfflinePlansPresenter,
} from "@/ui/presenters/OnboardingPresenter";

/** Render native onboarding controls to verify copy, choices and navigation. */
describe("OnboardingAccountConfirmationPresenter", () => {
  it("renders the tier and a British-formatted expiry date", () => {
    const { getByText } = renderWithTheme(
      <OnboardingAccountConfirmationPresenter
        benefits={[
          { title: "Loadout", description: "Train with your gym equipment." },
        ]}
        tierDisplayName="Premium+"
        expiresAt="2026-12-25T00:00:00.000Z"
        onContinue={jest.fn()}
      />,
    );

    expect(getByText("Loadout")).toBeTruthy();
    expect(getByText("Train with your gym equipment.")).toBeTruthy();
    expect(
      getByText("Your Premium+ access is active until 25 Dec 2026."),
    ).toBeTruthy();
  });

  it("falls back to a dateless message when there is no expiry", () => {
    const { getByText, queryByText } = renderWithTheme(
      <OnboardingAccountConfirmationPresenter
        benefits={[
          { title: "Loadout", description: "Train with your gym equipment." },
        ]}
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
        benefits={[
          { title: "Loadout", description: "Train with your gym equipment." },
        ]}
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

describe("onboarding choices", () => {
  it("lets the welcome screen continue or skip setup", () => {
    const onContinue = jest.fn();
    const onSkip = jest.fn();
    const screen = renderWithTheme(
      <OnboardingWelcomePresenter onContinue={onContinue} onSkip={onSkip} />,
    );
    expect(screen.getByText("Your profile")).toBeTruthy();
    fireEvent.press(screen.getByTestId("onboarding-welcome-continue"));
    fireEvent.press(screen.getByTestId("onboarding-welcome-skip"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("requires a role and a client band only when coaching", () => {
    const handlers = {
      onPathChange: jest.fn(),
      onBandChange: jest.fn(),
      onContinue: jest.fn(),
      onBack: jest.fn(),
      onSkip: jest.fn(),
    };
    const screen = renderWithTheme(
      <OnboardingRolePresenter path={null} band={null} {...handlers} />,
    );
    expect(
      screen.getByTestId("onboarding-role-continue").props.accessibilityState
        .disabled,
    ).toBe(true);
    fireEvent.press(screen.getByLabelText("For myself"));
    expect(handlers.onPathChange).toHaveBeenCalledWith("athlete");
    screen.rerender(
      <OnboardingRolePresenter path="athlete" band={null} {...handlers} />,
    );
    expect(
      screen.getByTestId("onboarding-role-continue").props.accessibilityState
        .disabled,
    ).toBe(false);
    fireEvent.press(screen.getByLabelText("Coach others"));
    expect(handlers.onPathChange).toHaveBeenCalledWith("coach");
    screen.rerender(
      <OnboardingRolePresenter path="coach" band={null} {...handlers} />,
    );
    expect(
      screen.getByTestId("onboarding-role-continue").props.accessibilityState
        .disabled,
    ).toBe(true);
    fireEvent.press(screen.getByTestId("onboarding-band-6_15"));
    expect(handlers.onBandChange).toHaveBeenCalledWith("6_15");
    screen.rerender(
      <OnboardingRolePresenter path="coach" band="6_15" {...handlers} />,
    );
    expect(
      screen.getByTestId("onboarding-band-6_15").props.accessibilityState
        .checked,
    ).toBe(true);
    fireEvent.press(screen.getByTestId("onboarding-role-continue"));
    fireEvent.press(screen.getByLabelText("Back"));
    fireEvent.press(screen.getByText("Skip"));
    expect(handlers.onContinue).toHaveBeenCalledTimes(1);
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onSkip).toHaveBeenCalledTimes(1);
  });

  it.each(["nutrition", "training"] as const)(
    "offers selectable %s preferences without granting access",
    (kind) => {
      const handlers = {
        onChange: jest.fn(),
        onContinue: jest.fn(),
        onBack: jest.fn(),
        onSkip: jest.fn(),
      };
      const options =
        kind === "nutrition"
          ? NUTRITION_ONBOARDING_OPTIONS
          : TRAINING_ONBOARDING_OPTIONS;
      const screen = renderWithTheme(
        <OnboardingIntentPresenter
          kind={kind}
          value={options[0].intent}
          {...handlers}
        />,
      );
      expect(screen.getByText(/does not unlock a feature/)).toBeTruthy();
      fireEvent.press(
        screen.getByTestId(`onboarding-intent-${options[2].intent}`),
      );
      expect(handlers.onChange).toHaveBeenCalledWith(options[2].intent);
      expect(
        screen.getByTestId(`onboarding-intent-${options[0].intent}`).props
          .accessibilityState.checked,
      ).toBe(true);
      fireEvent.press(screen.getByTestId(`onboarding-${kind}-continue`));
      fireEvent.press(screen.getByLabelText("Back"));
      fireEvent.press(screen.getByText("Skip"));
      expect(handlers.onContinue).toHaveBeenCalledTimes(1);
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
      expect(handlers.onSkip).toHaveBeenCalledTimes(1);
    },
  );
});
