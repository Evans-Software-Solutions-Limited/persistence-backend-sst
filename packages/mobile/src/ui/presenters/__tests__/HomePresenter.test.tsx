import { fireEvent } from "@testing-library/react-native";
import {
  HomePresenter,
  type HomePresenterProps,
  type HomePresenterViewModel,
} from "@/ui/presenters/HomePresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

jest.mock("react-native-reanimated-carousel", () => {
  const React = require("react");
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
});
