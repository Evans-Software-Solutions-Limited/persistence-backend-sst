import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
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
 * Custom tab-bar mount. Maps the active Expo Router route name to the
 * primitive's `active` id and forwards taps to `navigation.navigate`. Renders
 * the foundation <TabBar> inside a safe-area-padded container.
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

  return (
    <View style={{ paddingBottom: insets.bottom }}>
      <TabBar
        tabs={tabs}
        active={activeRoute}
        mode={mode}
        onChange={(id) => props.navigation.navigate(id)}
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
