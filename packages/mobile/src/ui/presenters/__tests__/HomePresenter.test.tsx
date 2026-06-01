import { fireEvent } from "@testing-library/react-native";
import {
  HomePresenter,
  type HomePresenterProps,
  type HomePresenterViewModel,
} from "@/ui/presenters/HomePresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

jest.mock("react-native-reanimated-carousel", () => {
  // Jest mock factories are hoisted above ESM imports — require() is
  // the only way to load modules inside them.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: ({ data, renderItem }: any) =>
      React.createElement(
        View,
        { testID: "carousel-mock" },
        data.map((item: any, index: number) =>
          React.createElement(
            View,
            { key: item.id ?? index },
            renderItem({ item, index, animationValue: { value: 0 } }),
          ),
        ),
      ),
  };
});

function makeViewModel(
  overrides: Partial<HomePresenterViewModel> = {},
): HomePresenterViewModel {
  const granted = {
    steps: "granted" as const,
    calories: "granted" as const,
    bodyWeight: "granted" as const,
    heartRate: "granted" as const,
  };
  return {
    userName: "Alex",
    avatarInitials: "AL",
    subscriptionTier: "free",
    isFreeTier: true,
    goals: [
      {
        id: "g-1",
        title: "10,000 Steps",
        current: 4812,
        target: 10000,
        unit: "steps",
        icon: "footsteps",
      },
    ],
    workouts: [
      {
        id: "w-1",
        name: "Push Day",
        description: "Chest + triceps",
        estimated_duration_minutes: 45,
        exercises: [],
        targeted_muscles: [],
        is_assigned: false,
        assigned_by_type: null,
        created_by: "user-1",
      },
    ],
    currentUserId: "user-1",
    workoutsThisMonth: 9,
    workoutsLastMonth: 12,
    activeEnergy: 312,
    basalEnergy: 0,
    standTime: 0,
    bodyWeight: 78.2,
    bodyWeightUnit: "kg",
    bodyWeightHistory: [],
    bodyFat: 16.5,
    bodyFatHistory: [],
    stepsToday: 4812,
    stepsHistory: [],
    recentActivity: [
      {
        workout_session_id: "s-1",
        workout_name: "Yesterday's session",
        completed_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      },
    ],
    latestBodyWeight: null,
    healthIsAvailable: true,
    healthPermissionStatus: granted,
    ...overrides,
  };
}

function renderHome(overrides: Partial<HomePresenterProps> = {}) {
  const props: HomePresenterProps = {
    viewModel: overrides.viewModel ?? makeViewModel(),
    animationStyles: [{}, {}, {}, {}, {}],
    isLoading: false,
    isRefreshing: false,
    onRefresh: jest.fn(),
    onUpgradePress: jest.fn(),
    onWorkoutPress: jest.fn(),
    onWorkoutStart: jest.fn(),
    onViewAllWorkoutsPress: jest.fn(),
    onViewAllProgressPress: jest.fn(),
    onConnectHealthPress: jest.fn(),
    ...overrides,
  };
  return { ...renderWithTheme(<HomePresenter {...props} />), props };
}

describe("HomePresenter", () => {
  it("renders every section with the fixture data", () => {
    const { getByTestId, getByText } = renderHome();
    expect(getByTestId("greeting-section")).toBeTruthy();
    expect(getByTestId("goals-section")).toBeTruthy();
    expect(getByTestId("your-workouts-section")).toBeTruthy();
    expect(getByTestId("my-progress-section")).toBeTruthy();
    expect(getByTestId("recent-activity-section")).toBeTruthy();
    expect(getByText("Alex")).toBeTruthy();
    expect(getByText("Push Day")).toBeTruthy();
  });

  it("fires the upgrade callback when the free-tier CTA is tapped", () => {
    const onUpgradePress = jest.fn();
    const { getByTestId } = renderHome({ onUpgradePress });
    fireEvent.press(getByTestId("subscription-upgrade"));
    expect(onUpgradePress).toHaveBeenCalled();
  });

  it("renders the view with refreshing state active", () => {
    const { getByTestId } = renderHome({ isRefreshing: true });
    expect(getByTestId("home-scroll")).toBeTruthy();
  });

  it("renders the PLogoDrawLoader full-screen when isLoading is true", () => {
    const { getByTestId, queryByTestId } = renderHome({ isLoading: true });
    expect(getByTestId("home-loader")).toBeTruthy();
    expect(getByTestId("logo-loader")).toBeTruthy();
    expect(queryByTestId("home-scroll")).toBeNull();
    expect(queryByTestId("greeting-section")).toBeNull();
  });

  describe("slow-loader caption (5s timer)", () => {
    it("hides the caption while isLoading is true but the timer hasn't fired", () => {
      const { queryByTestId } = renderHome({
        isLoading: true,
        showSlowLoaderCaption: false,
      });
      expect(queryByTestId("home-loader-caption")).toBeNull();
    });

    it("renders the caption alongside the loader once the timer fires", () => {
      const { getByTestId } = renderHome({
        isLoading: true,
        showSlowLoaderCaption: true,
      });
      expect(getByTestId("home-loader")).toBeTruthy();
      expect(getByTestId("home-loader-caption")).toBeTruthy();
    });
  });

  describe("error states (STORY-005 AC 5.9)", () => {
    const apiError = {
      kind: "api" as const,
      code: "timeout" as const,
      message: "Request timed out after 10000ms",
    };

    it("renders the blocking error state when there is an error and no userName", () => {
      const onRefresh = jest.fn();
      const { getByTestId, getByText, queryByTestId } = renderHome({
        viewModel: makeViewModel({ userName: null }),
        error: apiError,
        onRefresh,
      });
      expect(getByTestId("home-error-blocking")).toBeTruthy();
      expect(getByTestId("home-error-state")).toBeTruthy();
      // Timeout-specific copy from describeError().
      expect(getByText("Couldn't load your dashboard")).toBeTruthy();
      // Section tree must NOT render — the blocking state replaces it.
      expect(queryByTestId("home-scroll")).toBeNull();
      expect(queryByTestId("greeting-section")).toBeNull();
    });

    it("retry button on the blocking error state calls onRefresh", () => {
      const onRefresh = jest.fn();
      const { getByText } = renderHome({
        viewModel: makeViewModel({ userName: null }),
        error: apiError,
        onRefresh,
      });
      fireEvent.press(getByText("Retry"));
      expect(onRefresh).toHaveBeenCalled();
    });

    it("falls back to a generic message for unrecognised error codes (default branch)", () => {
      const { getByText } = renderHome({
        viewModel: makeViewModel({ userName: null }),
        error: { kind: "api", code: "server", message: "Something exploded" },
      });
      // describeError's default arm uses the upstream message when set.
      expect(getByText("Something exploded")).toBeTruthy();
    });

    it("uses the generic copy when the upstream message is empty", () => {
      const { getByText } = renderHome({
        viewModel: makeViewModel({ userName: null }),
        error: { kind: "api", code: "server", message: "" },
      });
      expect(
        getByText("Something went wrong on our side. Tap Retry to try again."),
      ).toBeTruthy();
    });

    it("renders error-code-tailored copy for unauthorized / network", () => {
      const { getByText, rerender } = renderHome({
        viewModel: makeViewModel({ userName: null }),
        error: { kind: "api", code: "unauthorized", message: "401" },
      });
      expect(getByText("Session expired")).toBeTruthy();

      rerender(
        <HomePresenter
          viewModel={makeViewModel({ userName: null })}
          animationStyles={[{}, {}, {}, {}, {}]}
          isLoading={false}
          isRefreshing={false}
          onRefresh={jest.fn()}
          onUpgradePress={jest.fn()}
          onWorkoutPress={jest.fn()}
          onWorkoutStart={jest.fn()}
          onViewAllWorkoutsPress={jest.fn()}
          onViewAllProgressPress={jest.fn()}
          onConnectHealthPress={jest.fn()}
          error={{ kind: "api", code: "network", message: "offline" }}
        />,
      );
      expect(getByText("No connection")).toBeTruthy();
    });

    it("renders the inline banner above the section tree when cache is present + error", () => {
      const { getByTestId } = renderHome({
        // userName non-null = cache present; error = refresh failed.
        error: apiError,
      });
      expect(getByTestId("home-error-banner")).toBeTruthy();
      // Section tree DOES render because we have cached data.
      expect(getByTestId("home-scroll")).toBeTruthy();
      expect(getByTestId("greeting-section")).toBeTruthy();
    });

    it("omits the inline banner when there is no error", () => {
      const { queryByTestId, getByTestId } = renderHome();
      expect(queryByTestId("home-error-banner")).toBeNull();
      // Sanity: the happy-path section tree still renders.
      expect(getByTestId("greeting-section")).toBeTruthy();
    });
  });
});
