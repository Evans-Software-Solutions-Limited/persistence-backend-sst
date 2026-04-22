import { fireEvent } from "@testing-library/react-native";
import { DASHBOARD_FIXTURE } from "@/adapters/api/__tests__/fixtures/dashboard.fixture";
import {
  HomePresenter,
  type HomePresenterProps,
  type HomePresenterViewModel,
} from "@/ui/presenters/HomePresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

jest.setTimeout(15_000);

function makeViewModel(): HomePresenterViewModel {
  return {
    firstName: DASHBOARD_FIXTURE.profile.firstName,
    subscription: DASHBOARD_FIXTURE.subscription,
    goals: DASHBOARD_FIXTURE.activeGoals,
    workouts: DASHBOARD_FIXTURE.recentWorkouts,
    progress: DASHBOARD_FIXTURE.progress,
    latestMeasurement: DASHBOARD_FIXTURE.latestMeasurement,
    prOfTheWeek: DASHBOARD_FIXTURE.prOfTheWeek,
    recentActivity: DASHBOARD_FIXTURE.recentActivity,
    stepsToday: 4812,
    activeCaloriesToday: 312,
    latestBodyWeight: null,
    healthIsAvailable: true,
    healthPermissionStatus: {
      steps: "granted",
      calories: "granted",
      bodyWeight: "granted",
      heartRate: "granted",
    },
    lastHealthReadAt: null,
  };
}

function renderHome(overrides: Partial<HomePresenterProps> = {}) {
  const viewModel = overrides.viewModel ?? makeViewModel();
  const props: HomePresenterProps = {
    viewModel,
    animationStyles: [{}, {}, {}, {}, {}],
    isRefreshing: false,
    onRefresh: jest.fn(),
    onUpgradePress: jest.fn(),
    onWorkoutPress: jest.fn(),
    onViewAllWorkoutsPress: jest.fn(),
    onViewAllProgressPress: jest.fn(),
    onConnectHealthPress: jest.fn(),
    onActivityPress: jest.fn(),
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
    expect(getByText("Hey, Alex")).toBeTruthy();
    expect(getByText("Barbell Bench Press")).toBeTruthy();
  });

  it("omits the PR-of-the-week card when prOfTheWeek is null", () => {
    const vm = makeViewModel();
    vm.prOfTheWeek = null;
    const { queryByTestId } = renderHome({ viewModel: vm });
    expect(queryByTestId("pr-of-the-week")).toBeNull();
  });

  it("fires the upgrade callback when a free-tier badge is tapped", () => {
    const vm = makeViewModel();
    vm.subscription = {
      tierName: null,
      isFreeTier: true,
      isTrainerTier: false,
      status: null,
    };
    const onUpgradePress = jest.fn();
    const { getByTestId } = renderHome({
      viewModel: vm,
      onUpgradePress,
    });
    fireEvent.press(getByTestId("subscription-upgrade"));
    expect(onUpgradePress).toHaveBeenCalled();
  });

  it("renders the view with refreshing state active", () => {
    const { getByTestId } = renderHome({ isRefreshing: true });
    expect(getByTestId("home-scroll")).toBeTruthy();
  });
});
