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
import { fireEvent, render, within } from "@testing-library/react-native";
// eslint-disable-next-line import/first
import { SafeAreaProvider } from "react-native-safe-area-context";
// eslint-disable-next-line import/first
import { TamaguiProvider } from "@tamagui/core";
// eslint-disable-next-line import/first
import config from "../../tamagui.config";
// eslint-disable-next-line import/first
import TabsLayout, {
  ACTIVE_WORKOUT_BAR_GAP,
  ATHLETE_TABS,
  COACH_TABS,
  NavTabBar,
  TAB_BAR_BOTTOM_GAP,
  TAB_BAR_CONTENT_HEIGHT,
  tabBarHeight,
} from "../(app)/(tabs)/_layout";

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

describe("tab-bar safe-area contract (Phase 14.8)", () => {
  it("tabBarHeight = content (60) + inset + gap (8)", () => {
    expect(tabBarHeight(0)).toBe(TAB_BAR_CONTENT_HEIGHT + TAB_BAR_BOTTOM_GAP);
    expect(tabBarHeight(34)).toBe(
      TAB_BAR_CONTENT_HEIGHT + 34 + TAB_BAR_BOTTOM_GAP,
    );
  });

  it("exposes the documented contract constants for 05-active-session", () => {
    expect(TAB_BAR_CONTENT_HEIGHT).toBe(60);
    expect(TAB_BAR_BOTTOM_GAP).toBe(8);
    expect(ACTIVE_WORKOUT_BAR_GAP).toBe(12);
  });

  function renderNavTabBar(insetBottom: number) {
    const props = {
      state: { index: 0, routeNames: ["index", "you", "train", "fuel"] },
      navigation: { navigate: jest.fn() },
    } as never;
    return render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 44, left: 0, right: 0, bottom: insetBottom },
        }}
      >
        <TamaguiProvider config={config} defaultTheme="dark">
          <NavTabBar props={props} tabs={ATHLETE_TABS} mode="athlete" />
        </TamaguiProvider>
      </SafeAreaProvider>,
    );
  }

  it("pads the tab bar by insets.bottom + 8 on a home-indicator device", () => {
    const { getByTestId } = renderNavTabBar(34);
    const safeArea = getByTestId("nav-tab-bar-safe-area");
    expect(safeArea.props.style.paddingBottom).toBe(34 + TAB_BAR_BOTTOM_GAP);
    expect(getByTestId("nav-tab-bar")).toBeTruthy();
  });

  it("pads naturally (no artificial inflation) on a no-home-indicator device", () => {
    const { getByTestId } = renderNavTabBar(0);
    const safeArea = getByTestId("nav-tab-bar-safe-area");
    // bottom inset 0 → just the float gap, no inflation.
    expect(safeArea.props.style.paddingBottom).toBe(TAB_BAR_BOTTOM_GAP);
  });
});

describe("NavTabBar — tabPress contract + stranded-route guard (review #87)", () => {
  type NavMock = {
    navigate: jest.Mock;
    emit: jest.Mock;
  };

  function renderNavTabBar({
    activeIndex,
    routeNames,
    tabs,
    mode,
    emitResult = { defaultPrevented: false },
  }: {
    activeIndex: number;
    routeNames: string[];
    tabs: typeof ATHLETE_TABS;
    mode: "athlete" | "coach";
    emitResult?: { defaultPrevented: boolean };
  }) {
    const navigation: NavMock = {
      navigate: jest.fn(),
      emit: jest.fn(() => emitResult),
    };
    const props = {
      state: {
        index: activeIndex,
        routeNames,
        routes: routeNames.map((name) => ({ name, key: `${name}-key` })),
      },
      navigation,
    } as never;
    const utils = render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <TamaguiProvider config={config} defaultTheme="dark">
          <NavTabBar props={props} tabs={tabs} mode={mode} />
        </TamaguiProvider>
      </SafeAreaProvider>,
    );
    return { ...utils, navigation };
  }

  const ATHLETE_ROUTES = [
    "index",
    "you",
    "train",
    "fuel",
    "clients",
    "programs",
  ];

  it("emits a cancellable tabPress then navigates on tapping a non-focused tab", () => {
    const { getByTestId, navigation } = renderNavTabBar({
      activeIndex: 0, // index
      routeNames: ATHLETE_ROUTES,
      tabs: ATHLETE_TABS,
      mode: "athlete",
    });
    fireEvent.press(getByTestId("tabbar-tab-train"));
    expect(navigation.emit).toHaveBeenCalledWith({
      type: "tabPress",
      target: "train-key",
      canPreventDefault: true,
    });
    expect(navigation.navigate).toHaveBeenCalledWith("train");
  });

  it("does NOT navigate when tabPress is defaultPrevented", () => {
    const { getByTestId, navigation } = renderNavTabBar({
      activeIndex: 0,
      routeNames: ATHLETE_ROUTES,
      tabs: ATHLETE_TABS,
      mode: "athlete",
      emitResult: { defaultPrevented: true },
    });
    fireEvent.press(getByTestId("tabbar-tab-train"));
    expect(navigation.emit).toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("re-tapping the focused tab emits but does not navigate", () => {
    const { getByTestId, navigation } = renderNavTabBar({
      activeIndex: 0, // index is focused
      routeNames: ATHLETE_ROUTES,
      tabs: ATHLETE_TABS,
      mode: "athlete",
    });
    fireEvent.press(getByTestId("tabbar-tab-index"));
    expect(navigation.emit).toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("redirects to index when the focused route is filtered out by the active mode", () => {
    // Watchdog demoted coach→athlete while parked on /clients: clients is no
    // longer in ATHLETE_TABS, so the guard redirects to Home.
    const { navigation } = renderNavTabBar({
      activeIndex: 4, // clients
      routeNames: ATHLETE_ROUTES,
      tabs: ATHLETE_TABS,
      mode: "athlete",
    });
    expect(navigation.navigate).toHaveBeenCalledWith("index");
  });

  it("does not redirect when the focused route exists in the active mode", () => {
    const { navigation } = renderNavTabBar({
      activeIndex: 4, // clients
      routeNames: ATHLETE_ROUTES,
      tabs: COACH_TABS, // coach mode — clients is valid
      mode: "coach",
    });
    expect(navigation.navigate).not.toHaveBeenCalledWith("index");
  });
});
