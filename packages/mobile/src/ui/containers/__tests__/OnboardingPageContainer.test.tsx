import { act, render, waitFor } from "@testing-library/react-native";

import type { SubscriptionSelectionContainerProps } from "@/ui/containers/SubscriptionSelectionContainer";
import { OnboardingPageContainer } from "@/ui/containers/OnboardingPageContainer";

const mockReplace = jest.fn();
const mockTrack = jest.fn();
const mockSkipPage = jest.fn();
const mockCompleteJourney = jest.fn();
let mockSubscriptionProps: SubscriptionSelectionContainerProps | null = null;

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

jest.mock("@/ui/hooks/useMySubscription", () => ({
  useMySubscription: () => ({ data: { tierName: "free" } }),
}));

jest.mock("@/ui/state/OnboardingProvider", () => ({
  useOnboarding: () => ({
    state: {
      userId: "user-a",
      version: 1,
      currentPage: "recommendation",
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
    dismissJourney: jest.fn(),
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
    mockSkipPage.mockResolvedValue(null);
    mockCompleteJourney.mockResolvedValue(undefined);
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
