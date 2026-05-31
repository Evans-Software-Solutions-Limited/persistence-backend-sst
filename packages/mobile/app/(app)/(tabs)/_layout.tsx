import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useEffect } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useUserMode } from "../../../src/state/user-mode";
import { color } from "../../../src/ui/theme";
import { TabBar, type TabSpec } from "../../../src/ui/components/foundation";
import {
  IconApple,
  IconChart,
  IconDumbbell,
  IconHome,
  IconLayers,
  IconUsers,
} from "../../../src/ui/components/icons";

/** The props Expo Router hands the custom `tabBar` render callback. */
type NavTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];

/**
 * Mode-aware tab layout — Option 3 (4-tab consolidated hubs).
 *
 * Spec: specs/14-navigation/design.md § <TabsLayout> — mode-aware tab routing
 *       + § Route registration pattern
 *       specs/14-navigation/requirements.md STORY-001 + STORY-002 + STORY-003
 *       (AC 3.4 re-render on mode swap)
 *       specs/14-navigation/tasks.md T-14.4.1–T-14.4.4
 *
 * Reads `useUserMode().mode` and swaps the visible tab spec:
 *   athlete → Home · Train · Fuel · You
 *   coach   → Home · Clients · Programs · You
 *
 * All six tab routes stay registered as <Tabs.Screen> regardless of mode;
 * the mode determines which are VISIBLE. Cross-mode routes get `href: null`
 * (hides the icon while keeping the route navigable from deep links +
 * programmatic router.replace). This generalises the M10.5 Wave 2 Clients-tab
 * gating pattern.
 *
 * The visual tab bar (glass surface, accent shift, COACH chrome dot, active
 * pill) is the <TabBar> foundation primitive (01-design-system). This layout
 * owns only the routing tree + mode selection. The cyan→violet accent
 * TRANSITION animation is Phase 14.6; the safe-area-inset formula refinement
 * + ActiveWorkoutBar height contract are Phase 14.8 (this PR applies a
 * baseline `paddingBottom: insets.bottom`).
 */

export const ATHLETE_TABS: TabSpec[] = [
  { id: "index", icon: IconHome, label: "Home" },
  { id: "train", icon: IconDumbbell, label: "Train" },
  { id: "fuel", icon: IconApple, label: "Fuel" },
  { id: "you", icon: IconChart, label: "You" },
];

export const COACH_TABS: TabSpec[] = [
  { id: "index", icon: IconHome, label: "Home" },
  { id: "clients", icon: IconUsers, label: "Clients" },
  { id: "programs", icon: IconLayers, label: "Programs" },
  { id: "you", icon: IconChart, label: "You" },
];

/**
 * Tab-bar layout contract (consumed by 05-active-session for the
 * <ActiveWorkoutBar> minimised-bar positioning — T-14.8.2).
 *
 * The visual <TabBar> content is ~60pt tall; the mount adds the safe-area
 * bottom inset + an 8pt gap so the bar floats clear of the home indicator
 * (AC 8.1). The minimised ActiveWorkoutBar floats at `tabBarHeight(insets) +
 * ACTIVE_WORKOUT_BAR_GAP` so it sits above the tab bar without overlapping it.
 */
export const TAB_BAR_CONTENT_HEIGHT = 60;
export const TAB_BAR_BOTTOM_GAP = 8;
/** Gap between the tab bar top edge and the minimised ActiveWorkoutBar. */
export const ACTIVE_WORKOUT_BAR_GAP = 12;

/** Total tab-bar height including the safe-area bottom inset + float gap. */
export function tabBarHeight(insetBottom: number): number {
  return TAB_BAR_CONTENT_HEIGHT + insetBottom + TAB_BAR_BOTTOM_GAP;
}

/**
 * Custom tab-bar mount. Maps the active Expo Router route name to the
 * primitive's `active` id and forwards taps to `navigation.navigate`. Renders
 * the foundation <TabBar> inside a safe-area-padded container that floats the
 * bar clear of the home indicator (paddingBottom = insets.bottom + 8, AC 8.1).
 * On devices without a home indicator (insets.bottom === 0) the bar pads
 * naturally without artificial inflation (AC 8.3).
 */
export function NavTabBar({
  props,
  tabs,
  mode,
}: {
  props: NavTabBarProps;
  tabs: TabSpec[];
  mode: "athlete" | "coach";
}) {
  const insets = useSafeAreaInsets();
  const activeRoute = props.state.routeNames[props.state.index];
  const activeInTabs = tabs.some((t) => t.id === activeRoute);

  // Stranded-route guard: when the mode flips (e.g. the eligibility watchdog
  // demotes coach→athlete while the user is on /clients or /programs), the
  // focused route may no longer exist in the new mode's tab set. Expo Router
  // does NOT auto-redirect away from a now-`href: null` route, so the user
  // would be parked on a hidden screen with nothing highlighted in the bar.
  // Redirect to Home (index) when that happens. (14-navigation review #87.)
  useEffect(() => {
    if (!activeInTabs) {
      props.navigation.navigate("index");
    }
  }, [activeInTabs, props.navigation]);

  // React Navigation custom-tabBar contract: emit `tabPress` (cancellable)
  // before navigating so screens can register scroll-to-top / stack-reset
  // listeners, and skip the navigate when re-tapping the focused tab.
  const handleChange = (id: string) => {
    const route = props.state.routes.find((r) => r.name === id);
    if (!route) return;
    const event = props.navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (id !== activeRoute && !event.defaultPrevented) {
      props.navigation.navigate(id);
    }
  };

  return (
    <View
      testID="nav-tab-bar-safe-area"
      style={{ paddingBottom: insets.bottom + TAB_BAR_BOTTOM_GAP }}
    >
      <TabBar
        tabs={tabs}
        active={activeRoute}
        mode={mode}
        onChange={handleChange}
        testID="nav-tab-bar"
      />
    </View>
  );
}

export default function TabsLayout() {
  const mode = useUserMode((s) => s.mode);
  const tabs = mode === "coach" ? COACH_TABS : ATHLETE_TABS;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.$bg },
      }}
      tabBar={(props) => <NavTabBar props={props} tabs={tabs} mode={mode} />}
    >
      {/* Always-registered athlete tabs. */}
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="you" options={{ title: "You" }} />

      {/* Athlete-only routes — hidden in coach mode. */}
      <Tabs.Screen
        name="train"
        options={{ title: "Train", href: mode === "coach" ? null : undefined }}
      />
      <Tabs.Screen
        name="fuel"
        options={{ title: "Fuel", href: mode === "coach" ? null : undefined }}
      />

      {/* Coach-only routes — hidden in athlete mode. */}
      <Tabs.Screen
        name="clients"
        options={{
          title: "Clients",
          href: mode === "coach" ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="programs"
        options={{
          title: "Programs",
          href: mode === "coach" ? undefined : null,
        }}
      />
    </Tabs>
  );
}
