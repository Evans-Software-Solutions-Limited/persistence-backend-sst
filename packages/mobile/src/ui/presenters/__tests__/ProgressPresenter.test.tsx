import { fireEvent, render, screen } from "@testing-library/react-native";
import type { FeatureGatePromptProps } from "@/ui/components/subscription/FeatureGatePrompt";
import {
  ProgressPresenter,
  type ProgressPresenterProps,
  type ProgressPresenterViewModel,
} from "../ProgressPresenter";

function makeViewModel(
  overrides: Partial<ProgressPresenterViewModel> = {},
): ProgressPresenterViewModel {
  return {
    isLoading: false,
    isRefreshing: false,
    errorMessage: null,
    workoutsThisMonth: 7,
    workoutsLastMonth: 5,
    ...overrides,
  };
}

function makeGateProps(
  overrides: Partial<FeatureGatePromptProps> = {},
): FeatureGatePromptProps {
  return {
    feature: "gym_buddy",
    featureDisplayName: "Gym Buddy access",
    currentTier: "free",
    upgradeTo: "basic",
    upgradePriceMonthly: 4.99,
    onUpgrade: jest.fn(),
    ...overrides,
  };
}

function renderProgress(overrides: Partial<ProgressPresenterProps> = {}) {
  const props: ProgressPresenterProps = {
    viewModel: overrides.viewModel ?? makeViewModel(),
    analyticsGate: overrides.analyticsGate ?? null,
    onRefresh: overrides.onRefresh ?? jest.fn(),
  };
  return { ...render(<ProgressPresenter {...props} />), props };
}

describe("ProgressPresenter", () => {
  it("renders the loader full-screen when isLoading is true", () => {
    renderProgress({ viewModel: makeViewModel({ isLoading: true }) });
    expect(screen.getByTestId("progress-loader")).toBeTruthy();
    expect(screen.queryByTestId("progress-screen")).toBeNull();
  });

  it("renders the basic stats card with the workout count", () => {
    renderProgress();
    expect(screen.getByTestId("progress-basic-stats")).toBeTruthy();
    expect(
      screen.getByTestId("progress-workouts-this-month").props.children,
    ).toBe(7);
  });

  it("describes the delta as 'up from last month' when current exceeds last", () => {
    renderProgress({
      viewModel: makeViewModel({
        workoutsThisMonth: 10,
        workoutsLastMonth: 6,
      }),
    });
    expect(screen.getByText("4 up from last month")).toBeTruthy();
  });

  it("describes the delta as 'down from last month' when current trails last", () => {
    renderProgress({
      viewModel: makeViewModel({
        workoutsThisMonth: 3,
        workoutsLastMonth: 8,
      }),
    });
    expect(screen.getByText("5 down from last month")).toBeTruthy();
  });

  it("describes the delta as 'same as last month' when equal", () => {
    renderProgress({
      viewModel: makeViewModel({
        workoutsThisMonth: 7,
        workoutsLastMonth: 7,
      }),
    });
    expect(screen.getByText("Same as last month")).toBeTruthy();
  });

  it("hides the advanced-analytics section while analyticsGate is null", () => {
    renderProgress({ analyticsGate: null });
    expect(screen.queryByTestId("progress-advanced-analytics")).toBeNull();
    expect(screen.queryByTestId("feature-gate-prompt-gym_buddy")).toBeNull();
    expect(screen.queryByTestId("progress-analytics-placeholder")).toBeNull();
  });

  it("renders the feature-gate prompt when analyticsGate denies", () => {
    renderProgress({
      analyticsGate: { allowed: false, gateProps: makeGateProps() },
    });
    expect(screen.getByTestId("progress-advanced-analytics")).toBeTruthy();
    expect(screen.getByTestId("feature-gate-prompt-gym_buddy")).toBeTruthy();
    // Placeholder for premium must NOT be present when gate denies.
    expect(screen.queryByTestId("progress-analytics-placeholder")).toBeNull();
  });

  it("renders the 'Coming soon' placeholder for premium users (gate allows)", () => {
    renderProgress({
      analyticsGate: { allowed: true, gateProps: makeGateProps() },
    });
    expect(screen.getByTestId("progress-analytics-placeholder")).toBeTruthy();
    expect(screen.queryByTestId("feature-gate-prompt-gym_buddy")).toBeNull();
  });

  it("renders the error banner when errorMessage is set", () => {
    renderProgress({
      viewModel: makeViewModel({ errorMessage: "Couldn't refresh — showing cached data." }),
    });
    expect(screen.getByTestId("progress-error-banner")).toBeTruthy();
  });

  it("hides the error banner when errorMessage is null", () => {
    renderProgress();
    expect(screen.queryByTestId("progress-error-banner")).toBeNull();
  });

  it("forwards the gate's onUpgrade through the FeatureGatePrompt", () => {
    const onUpgrade = jest.fn();
    renderProgress({
      analyticsGate: {
        allowed: false,
        gateProps: makeGateProps({ onUpgrade }),
      },
    });
    fireEvent.press(screen.getByTestId("feature-gate-upgrade"));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});
