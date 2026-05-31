/**
 * Tabs layout tests — Option 3 mode-aware routing (14-navigation Phase 14.4).
 *
 * Two concerns:
 *  1. Route registration: all six tab routes stay registered as
 *     <Tabs.Screen>; the active mode decides which are VISIBLE via
 *     `options.href` (null hides while keeping the route navigable).
 *  2. The visible tab spec: athlete → Home/Train/Fuel/You,
 *     coach → Home/Clients/Programs/You — driven by useUserMode().mode.
 *
 * Spec: specs/14-navigation/design.md § <TabsLayout> + § Route registration
 *       specs/14-navigation/requirements.md STORY-001, STORY-002, STORY-003
 *       specs/14-navigation/tasks.md T-14.4.1, T-14.4.4 (STORY-009 AC 9.3)
 */

// Capture every <Tabs.Screen> mounted under <Tabs> so we can assert on the
// per-tab `options.href` (the visibility hinge). Also capture the `tabBar`
// render prop so we can render the custom NavTabBar in isolation.
type CapturedScreen = {
  name: string;
  href: string | null | undefined;
  title: string;
};

const capturedScreens: CapturedScreen[] = [];

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  function Tabs(props: {
    children: React.ReactNode;
    tabBar?: (p: unknown) => React.ReactNode;
  }) {
    // Render the custom tabBar with a minimal navigation state so the
    // visible-tab assertions can exercise it. The route names mirror the
    // registered screens; index 0 is active.
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
          navigation: { navigate: jest.fn() },
        })
      : null;
    return React.createElement(
      React.Fragment,
      null,
      tabBarNode,
      props.children,
    );
  }
  function TabsScreen(props: {
    name: string;
    options?: { href?: string | null; title?: string };
  }) {
    capturedScreens.push({
      name: props.name,
      href: props.options?.href,
      title: props.options?.title ?? "",
    });
    return null;
  }
  Tabs.Screen = TabsScreen;
  return { Tabs };
});

// Drive the mode by hand.
type MockModeReturn = "athlete" | "coach";
const mockMode = jest.fn<MockModeReturn, []>();
jest.mock("../../src/state/user-mode", () => ({
  useUserMode: (selector: (s: { mode: MockModeReturn }) => unknown) =>
    selector({ mode: mockMode() }),
}));

// eslint-disable-next-line import/first
import { render, within } from "@testing-library/react-native";
// eslint-disable-next-line import/first
import { SafeAreaProvider } from "react-native-safe-area-context";
// eslint-disable-next-line import/first
import { TamaguiProvider } from "@tamagui/core";
// eslint-disable-next-line import/first
import config from "../../tamagui.config";
// eslint-disable-next-line import/first
import TabsLayout from "../(app)/(tabs)/_layout";

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
};

function renderLayout() {
  return render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <TamaguiProvider config={config} defaultTheme="dark">
        <TabsLayout />
      </TamaguiProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  capturedScreens.length = 0;
  mockMode.mockReset();
  mockMode.mockReturnValue("athlete");
});

describe("TabsLayout — route registration", () => {
  it("registers all six tab routes regardless of mode", () => {
    renderLayout();
    const names = capturedScreens.map((s) => s.name).sort();
    expect(names).toEqual(
      ["index", "you", "train", "fuel", "clients", "programs"].sort(),
    );
  });

  it("athlete mode: athlete tabs visible, coach tabs hidden (href: null)", () => {
    mockMode.mockReturnValue("athlete");
    renderLayout();
    const byName = Object.fromEntries(
      capturedScreens.map((s) => [s.name, s.href]),
    );
    // Visible (href undefined → default route).
    expect(byName.index).toBeUndefined();
    expect(byName.train).toBeUndefined();
    expect(byName.fuel).toBeUndefined();
    expect(byName.you).toBeUndefined();
    // Hidden (href null).
    expect(byName.clients).toBeNull();
    expect(byName.programs).toBeNull();
  });

  it("coach mode: coach tabs visible, athlete-only tabs hidden (href: null)", () => {
    mockMode.mockReturnValue("coach");
    renderLayout();
    const byName = Object.fromEntries(
      capturedScreens.map((s) => [s.name, s.href]),
    );
    // Visible.
    expect(byName.index).toBeUndefined();
    expect(byName.clients).toBeUndefined();
    expect(byName.programs).toBeUndefined();
    expect(byName.you).toBeUndefined();
    // Hidden.
    expect(byName.train).toBeNull();
    expect(byName.fuel).toBeNull();
  });
});

describe("TabsLayout — visible tab spec (STORY-009 AC 9.3)", () => {
  it("renders exactly the four athlete tabs with their labels", () => {
    mockMode.mockReturnValue("athlete");
    const { getByTestId } = renderLayout();
    const bar = within(getByTestId("nav-tab-bar"));
    for (const label of ["Home", "Train", "Fuel", "You"]) {
      expect(bar.getByText(label)).toBeTruthy();
    }
    // The athlete-only labels Clients/Programs are absent.
    expect(bar.queryByText("Clients")).toBeNull();
    expect(bar.queryByText("Programs")).toBeNull();
  });

  it("renders exactly the four coach tabs with their labels", () => {
    mockMode.mockReturnValue("coach");
    const { getByTestId } = renderLayout();
    const bar = within(getByTestId("nav-tab-bar"));
    for (const label of ["Home", "Clients", "Programs", "You"]) {
      expect(bar.getByText(label)).toBeTruthy();
    }
    expect(bar.queryByText("Train")).toBeNull();
    expect(bar.queryByText("Fuel")).toBeNull();
  });

  it("shows the COACH chrome dot only in coach mode", () => {
    mockMode.mockReturnValue("coach");
    const coach = renderLayout();
    expect(coach.getByTestId("tabbar-coach-dot")).toBeTruthy();

    capturedScreens.length = 0;
    mockMode.mockReturnValue("athlete");
    const athlete = renderLayout();
    expect(athlete.queryByTestId("tabbar-coach-dot")).toBeNull();
  });
});
