import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

import type { OnboardingPage } from "@/domain/models/onboarding";
import type { SubscriptionSelectionContainerProps } from "@/ui/containers/SubscriptionSelectionContainer";
import { OnboardingPageContainer } from "@/ui/containers/OnboardingPageContainer";

const mockReplace = jest.fn();
const mockTrack = jest.fn();
const mockSkipPage = jest.fn();
const mockDismissJourney = jest.fn();
const mockCompleteJourney = jest.fn();
let mockSubscriptionProps: SubscriptionSelectionContainerProps | null = null;
let mockCurrentPage: OnboardingPage = "recommendation";

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
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
  };
});

jest.mock("@/ui/hooks/useMySubscription", () => ({
  useMySubscription: () => ({ data: { tierName: "free" } }),
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
    goBack: jest.fn(),
    completePage: jest.fn(),
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

describe("OnboardingPageContainer recommendation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscriptionProps = null;
    mockCurrentPage = "recommendation";
    mockSkipPage.mockResolvedValue(null);
    mockDismissJourney.mockResolvedValue(undefined);
    mockCompleteJourney.mockResolvedValue(undefined);
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
});
