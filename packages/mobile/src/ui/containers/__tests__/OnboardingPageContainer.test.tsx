import type { ReactElement } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert, BackHandler } from "react-native";
import { TamaguiProvider } from "@tamagui/core";

import tamaguiConfig from "../../../../tamagui.config";
import type { OnboardingPage } from "@/domain/models/onboarding";
import type { SubscriptionSelectionContainerProps } from "@/ui/containers/SubscriptionSelectionContainer";
import { OnboardingPageContainer } from "@/ui/containers/OnboardingPageContainer";

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockDismissTo = jest.fn();
const mockTrack = jest.fn();
const mockGoBack = jest.fn();
const mockCompletePage = jest.fn();
const mockSkipPage = jest.fn();
const mockDismissJourney = jest.fn();
const mockCompleteJourney = jest.fn();
let mockSubscriptionProps: SubscriptionSelectionContainerProps | null = null;
let mockIntentProps: { onContinue: () => void } | null = null;
let mockConfirmationProps: {
  tierDisplayName: string;
  expiresAt: string | null;
  onContinue: () => void;
} | null = null;
let mockCurrentPage: OnboardingPage = "recommendation";
let mockIsFocused = true;
const mockRefetch = jest.fn();
let mockSubscriptionData:
  | { tierName: string; tierDisplayName?: string; expiresAt?: string | null }
  | undefined = { tierName: "free" };
let mockSubscriptionIsError = false;

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
    dismissTo: mockDismissTo,
  }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = jest.requireActual("react");
    const focused = mockIsFocused;
    React.useEffect(() => {
      if (!focused) return;
      return callback();
    }, [callback, focused]);
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@/ui/presenters/OnboardingPresenter", () => {
  const actual = jest.requireActual("@/ui/presenters/OnboardingPresenter");
  const React = jest.requireActual("react");
  const { Pressable } = jest.requireActual("react-native");
  return {
    ...actual,
    OnboardingWelcomePresenter: ({ onSkip }: { onSkip: () => void }) =>
      React.createElement(Pressable, {
        onPress: onSkip,
        testID: "onboarding-welcome-skip",
      }),
    OnboardingIntentPresenter: (props: { onContinue: () => void }) => {
      mockIntentProps = props;
      return null;
    },
    OnboardingAccountConfirmationPresenter: (props: {
      tierDisplayName: string;
      expiresAt: string | null;
      onContinue: () => void;
    }) => {
      mockConfirmationProps = props;
      return React.createElement(Pressable, {
        onPress: props.onContinue,
        testID: "onboarding-account-confirmation-continue",
      });
    },
  };
});

jest.mock("@/ui/hooks/useMySubscription", () => ({
  useMySubscription: () => ({
    data: mockSubscriptionData,
    isError: mockSubscriptionIsError,
    refetch: mockRefetch,
  }),
}));

jest.mock("@/ui/state/OnboardingProvider", () => ({
  useOnboarding: () => ({
    state: {
      userId: "user-a",
      version: 1,
      currentPage: mockCurrentPage,
      completedPages: [
        "welcome",
        "profile",
        "role",
        "habits",
        "nutrition",
        "train",
      ],
      skippedPages: [],
      status: "in_progress",
      path: "athlete",
      coachClientBand: null,
      intentKeys: ["nutrition_mealprint", "training_loadout"],
      completedAt: null,
      dismissedAt: null,
      updatedAt: "2026-09-01T12:00:00.000Z",
    },
    isLoading: false,
    goBack: mockGoBack,
    completePage: mockCompletePage,
    skipPage: mockSkipPage,
    dismissJourney: mockDismissJourney,
    completeJourney: mockCompleteJourney,
    setPath: jest.fn(),
    setIntentChoice: jest.fn(),
    track: mockTrack,
  }),
}));

jest.mock("@/ui/containers/SubscriptionSelectionContainer", () => ({
  SubscriptionSelectionContainer: (
    props: SubscriptionSelectionContainerProps,
  ) => {
    mockSubscriptionProps = props;
    return null;
  },
}));

// Not `__tests__/test-utils`'s `renderWithTheme` — that also wraps with
// `SafeAreaProvider`, which this file's own `react-native-safe-area-context`
// mock above replaces entirely (only `useSafeAreaInsets` survives), leaving
// `SafeAreaProvider` undefined. This local wrapper only needs the Tamagui
// config the loader's real `View`/`Text` require.
function renderWithTamagui(ui: ReactElement) {
  return render(
    <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
      {ui}
    </TamaguiProvider>,
  );
}

describe("OnboardingPageContainer recommendation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscriptionProps = null;
    mockIntentProps = null;
    mockConfirmationProps = null;
    mockCurrentPage = "recommendation";
    mockIsFocused = true;
    mockSkipPage.mockResolvedValue(null);
    mockDismissJourney.mockResolvedValue(undefined);
    mockCompleteJourney.mockResolvedValue(undefined);
    mockGoBack.mockResolvedValue("train");
    mockCompletePage.mockResolvedValue("recommendation");
    mockSubscriptionData = { tierName: "free" };
    mockSubscriptionIsError = false;
    mockRefetch.mockReset();
  });

  it("warns before dismissing the whole journey from the Welcome header", async () => {
    mockCurrentPage = "welcome";
    const alert = jest.spyOn(Alert, "alert");
    const { getByTestId } = render(<OnboardingPageContainer page="welcome" />);

    fireEvent.press(getByTestId("onboarding-welcome-skip"));

    expect(mockDismissJourney).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      "Skip setup?",
      expect.stringContaining("takes you straight to Home"),
      expect.arrayContaining([
        expect.objectContaining({ text: "Keep setting up", style: "cancel" }),
        expect.objectContaining({ text: "Skip setup", style: "destructive" }),
      ]),
    );

    const buttons = alert.mock.calls[0]?.[2];
    const confirm = buttons?.find((button) => button.text === "Skip setup");
    act(() => confirm?.onPress?.());

    await waitFor(() => {
      expect(mockDismissJourney).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)");
    });
  });

  it("uses selectedTier for plan-selection analytics", () => {
    render(<OnboardingPageContainer page="recommendation" />);

    mockSubscriptionProps?.onboardingRecommendation?.onPlanSelected?.(
      "premium_plus",
    );
    expect(mockTrack).toHaveBeenCalledWith("onboarding_plan_selected", {
      selectedTier: "premium_plus",
    });
  });

  it("does not redirect an inactive onboarding screen after a forward push", () => {
    mockCurrentPage = "train";
    mockIsFocused = false;

    render(<OnboardingPageContainer page="nutrition" />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("reconciles provider state after a pushed screen loses and regains focus", async () => {
    mockCurrentPage = "train";
    const screen = render(<OnboardingPageContainer page="train" />);
    act(() => mockIntentProps?.onContinue());
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/(onboarding)/recommendation");
    });

    mockCurrentPage = "recommendation";
    mockIsFocused = false;
    screen.rerender(<OnboardingPageContainer page="train" />);
    mockReplace.mockClear();

    mockIsFocused = true;
    screen.rerender(<OnboardingPageContainer page="train" />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(onboarding)/recommendation");
    });
  });

  it("routes Android system Back through persisted onboarding state", async () => {
    let hardwareBack: (() => boolean | null | undefined) | undefined;
    jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation((_event, handler) => {
        hardwareBack = handler;
        return { remove: jest.fn() };
      });

    render(<OnboardingPageContainer page="recommendation" />);
    expect(hardwareBack?.()).toBe(true);

    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalledTimes(1);
      expect(mockDismissTo).toHaveBeenCalledWith("/(onboarding)/train");
    });
  });

  it("pushes forward and dismisses backward for native direction-aware transitions", async () => {
    const recommendation = render(
      <OnboardingPageContainer page="recommendation" />,
    );

    act(() => {
      mockSubscriptionProps?.onboardingRecommendation?.onBack();
    });
    await waitFor(() => {
      expect(mockDismissTo).toHaveBeenCalledWith("/(onboarding)/train");
    });

    recommendation.unmount();
    mockCurrentPage = "train";
    mockCompletePage.mockResolvedValue("recommendation");
    render(<OnboardingPageContainer page="train" />);
    act(() => mockIntentProps?.onContinue());
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/(onboarding)/recommendation");
    });
  });

  it("skips the recommendation, records it, and opens Home", async () => {
    render(<OnboardingPageContainer page="recommendation" />);

    act(() => {
      mockSubscriptionProps?.onboardingRecommendation?.onSkip();
    });

    await waitFor(() => {
      expect(mockSkipPage).toHaveBeenCalledWith("recommendation");
      expect(mockCompleteJourney).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)");
    });
  });

  it("shows the loader instead of any onboarding page while the entitlement is still unknown", () => {
    mockCurrentPage = "welcome";
    mockSubscriptionData = undefined;
    const { getByTestId, queryByTestId } = renderWithTamagui(
      <OnboardingPageContainer page="welcome" />,
    );

    expect(getByTestId("logo-loader")).toBeTruthy();
    expect(queryByTestId("onboarding-welcome-skip")).toBeNull();
  });

  it("carries on when the entitlement read has failed for good", () => {
    // The query stops after its retries, so `data` stays undefined forever.
    // Waiting on it would strand a brand-new user on a loading screen for the
    // rest of the session over one bad request or a moment offline. An
    // entitlement that arrives late is applied on the next launch; an
    // onboarding that never renders leaves nowhere to go.
    mockCurrentPage = "welcome";
    mockSubscriptionData = undefined;
    mockSubscriptionIsError = true;
    const { getByTestId, queryByTestId } = renderWithTamagui(
      <OnboardingPageContainer page="welcome" />,
    );

    expect(queryByTestId("logo-loader")).toBeNull();
    expect(getByTestId("onboarding-welcome-skip")).toBeTruthy();
  });

  it("does not treat a failed read as an entitlement", () => {
    // Failing OPEN on the loader must not fail open on access: a failed read
    // is not a paid account, and confirming access nobody has would be worse
    // than showing the plans.
    mockSubscriptionData = undefined;
    mockSubscriptionIsError = true;
    render(<OnboardingPageContainer page="recommendation" />);
    expect(mockSubscriptionProps).not.toBeNull();
  });

  it("replaces the recommendation page with an account-only confirmation for a paid entitlement", async () => {
    mockSubscriptionData = {
      tierName: "premium_plus",
      tierDisplayName: "Premium+",
      expiresAt: "2026-12-25T00:00:00.000Z",
    };

    const { getByTestId } = render(
      <OnboardingPageContainer page="recommendation" />,
    );

    expect(mockSubscriptionProps).toBeNull();
    expect(mockConfirmationProps).toEqual({
      tierDisplayName: "Premium+",
      expiresAt: "2026-12-25T00:00:00.000Z",
      onContinue: expect.any(Function),
    });

    fireEvent.press(getByTestId("onboarding-account-confirmation-continue"));

    await waitFor(() => {
      expect(mockCompletePage).toHaveBeenCalledWith("recommendation");
      expect(mockCompleteJourney).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)");
    });

    expect(mockTrack).not.toHaveBeenCalledWith(
      "onboarding_plan_selected",
      expect.anything(),
    );
  });

  it("tracks the account-only mode instead of a plan selection when the page is first viewed entitled", () => {
    mockSubscriptionData = { tierName: "premium", tierDisplayName: "Premium" };

    render(<OnboardingPageContainer page="recommendation" />);

    expect(mockTrack).toHaveBeenCalledWith("onboarding_recommendation_viewed", {
      onboarding_mode: "account_only",
    });
  });

  it("tracks a plain recommendation view (no account-only property) for a free user", () => {
    render(<OnboardingPageContainer page="recommendation" />);

    expect(mockTrack).toHaveBeenCalledWith(
      "onboarding_recommendation_viewed",
      undefined,
    );
  });

  it("re-checks the entitlement on arrival at the recommendation page", () => {
    render(<OnboardingPageContainer page="recommendation" />);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("does not re-check the entitlement on an earlier onboarding page", () => {
    mockCurrentPage = "welcome";
    render(<OnboardingPageContainer page="welcome" />);
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("switches from the paywall to the confirmation once a mid-journey entitlement resolves", () => {
    const screen = render(<OnboardingPageContainer page="recommendation" />);
    expect(mockSubscriptionProps).not.toBeNull();

    // Reset the mock's capture so a re-render that DIDN'T re-invoke
    // SubscriptionSelectionContainer can't be mistaken for one that did.
    mockSubscriptionProps = null;
    mockSubscriptionData = {
      tierName: "premium",
      tierDisplayName: "Premium",
      expiresAt: "2026-12-25T00:00:00.000Z",
    };
    screen.rerender(<OnboardingPageContainer page="recommendation" />);

    expect(mockSubscriptionProps).toBeNull();
    expect(mockConfirmationProps).toMatchObject({
      tierDisplayName: "Premium",
      expiresAt: "2026-12-25T00:00:00.000Z",
    });
  });
});
