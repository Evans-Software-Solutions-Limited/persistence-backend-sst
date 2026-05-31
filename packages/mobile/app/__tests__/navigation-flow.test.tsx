/**
 * Navigation acceptance-flow integration test (14-navigation Phase 14.9).
 *
 * Automates as much of the manual e2e acceptance gate as the jsdom test env
 * allows — the cross-cutting flow that no single phase's unit tests cover:
 *
 *   athlete: Home · Train (Workouts|Exercises) · Fuel · You
 *   trainer: open drawer → switch to coach → Home · Clients · Programs · You
 *
 * Spec: specs/14-navigation/tasks.md T-14.9.4 + Acceptance gate
 *       specs/14-navigation/requirements.md STORY-001, STORY-002, STORY-003,
 *       STORY-005
 *
 * The TabsLayout + Train hub are exercised via their mode-driven specs; the
 * drawer + mode-switch via the slices + useModeSwitch handler. Per-screen
 * content (owned by 04/06/08/10/13) is out of scope and stubbed.
 */

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  function Tabs(props: {
    children: React.ReactNode;
    tabBar?: (p: unknown) => React.ReactNode;
  }) {
    const tabBarNode = props.tabBar
      ? props.tabBar({
          state: {
            index: 0,
            routeNames: [
              "index",
              "you",
              "train",
              "fuel",
              "clients",
              "programs",
            ],
          },
          navigation: { navigate: mockNavigate },
        })
      : null;
    return React.createElement(
      React.Fragment,
      null,
      tabBarNode,
      props.children,
    );
  }
  function TabsScreen() {
    return null;
  }
  Tabs.Screen = TabsScreen;
  return {
    Tabs,
    router: { navigate: mockNavigate, replace: mockReplace },
  };
});

// eslint-disable-next-line import/first
import { act, render, within } from "@testing-library/react-native";
// eslint-disable-next-line import/first
import { SafeAreaProvider } from "react-native-safe-area-context";
// eslint-disable-next-line import/first
import { TamaguiProvider } from "@tamagui/core";
// eslint-disable-next-line import/first
import config from "../../tamagui.config";
// eslint-disable-next-line import/first
import { useDrawer } from "../../src/state/drawer";
// eslint-disable-next-line import/first
import { useUserMode } from "../../src/state/user-mode";
// eslint-disable-next-line import/first
import TabsLayout from "../(app)/(tabs)/_layout";

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
};

function renderTabs() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <TamaguiProvider config={config} defaultTheme="dark">
        <TabsLayout />
      </TamaguiProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockReplace.mockReset();
  useUserMode.setState({
    mode: "athlete",
    isTrainerEligible: false,
    isEligibilityKnown: true,
  });
  useDrawer.setState({ open: false });
});

describe("navigation acceptance flow", () => {
  it("athlete sees Home / Train / Fuel / You", () => {
    const { getByTestId } = renderTabs();
    const bar = within(getByTestId("nav-tab-bar"));
    for (const label of ["Home", "Train", "Fuel", "You"]) {
      expect(bar.getByText(label)).toBeTruthy();
    }
    expect(bar.queryByText("Clients")).toBeNull();
  });

  it("the avatar trigger contract: openDrawer flips the drawer slice", () => {
    // The avatar in every screen header calls useDrawer().openDrawer (the
    // slot + hook this spec ships). The drawer body is 08's.
    expect(useDrawer.getState().open).toBe(false);
    act(() => {
      useDrawer.getState().openDrawer();
    });
    expect(useDrawer.getState().open).toBe(true);
  });

  it("an eligible trainer switching to coach sees Home / Clients / Programs / You", async () => {
    // Eligibility resolved (trainer tier) → switchTo('coach') takes effect.
    await act(async () => {
      useUserMode.setState({ isTrainerEligible: true });
      await useUserMode.getState().switchTo("coach");
    });

    const { getByTestId } = renderTabs();
    const bar = within(getByTestId("nav-tab-bar"));
    for (const label of ["Home", "Clients", "Programs", "You"]) {
      expect(bar.getByText(label)).toBeTruthy();
    }
    expect(bar.queryByText("Train")).toBeNull();
    expect(bar.queryByText("Fuel")).toBeNull();
    // Coach chrome dot is visible.
    expect(getByTestId("tabbar-coach-dot")).toBeTruthy();
  });

  it("a non-eligible athlete cannot switch to coach (stays athlete IA)", async () => {
    await act(async () => {
      await useUserMode.getState().switchTo("coach");
    });
    expect(useUserMode.getState().mode).toBe("athlete");

    const { getByTestId } = renderTabs();
    const bar = within(getByTestId("nav-tab-bar"));
    expect(bar.getByText("Train")).toBeTruthy();
    expect(bar.queryByText("Clients")).toBeNull();
  });
});
