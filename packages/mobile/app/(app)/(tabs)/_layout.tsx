import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colorPalette } from "../../../src/ui/theme";
import { useMySubscription } from "../../../src/ui/hooks/useMySubscription";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

type TabIconProps = {
  focused: boolean;
  color: string;
  size: number;
  focusedName: IoniconName;
  unfocusedName: IoniconName;
};

/**
 * Transitional Option 3 tab layout — registers the new 4-tab IA
 * (Home / Train / Fuel / You + coach-only Clients / Programs) using the
 * legacy Ionicons `TabIcon` rendering so the app stays bootable.
 *
 * Phase 14.4 rewrites this to the mode-aware `<TabBar>` foundation
 * primitive driven by `useUserMode`, removing this `TabIcon` helper +
 * the 24×2pt indicator. This PR (14.3) only restructures the ROUTE SET.
 *
 * Spec: specs/14-navigation/design.md § <TabsLayout> + § Route registration
 *       specs/14-navigation/requirements.md STORY-001, STORY-002
 *       specs/14-navigation/tasks.md T-14.3.* (route slots)
 *
 * Route registration pattern: all six tab routes stay registered as
 * `<Tabs.Screen>` regardless of mode. Coach-only routes (clients, programs)
 * are hidden via `href: null` here and surfaced by mode in 14.4. Until 14.4
 * lands, Clients keeps the M10.5 Wave 2 trainer-tier gate so the route stays
 * reachable for the post-payment "Manage Clients" CTA.
 */
function TabIcon({
  focused,
  color,
  size,
  focusedName,
  unfocusedName,
}: TabIconProps) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      {focused && (
        <View
          style={{
            position: "absolute",
            top: -10,
            width: 24,
            height: 2,
            borderRadius: 1,
            backgroundColor: colorPalette.primary500,
          }}
        />
      )}
      <Ionicons
        name={focused ? focusedName : unfocusedName}
        color={color}
        size={size}
      />
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 60 + insets.bottom;

  // Coach-only routes (clients, programs) are registered but hidden in this
  // transitional layout. Clients keeps the M10.5 Wave 2 trainer-tier gate so
  // the post-payment Success "Manage Clients" CTA still resolves; 14.4
  // replaces both with mode-driven visibility.
  const subQuery = useMySubscription();
  const isTrainerTier = subQuery.data?.isTrainerTier ?? false;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colorPalette.neutral1000 },
        headerTintColor: colorPalette.neutral0,
        headerTitleStyle: { fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: colorPalette.neutral1000,
          borderTopColor: "rgba(40, 40, 48, 0.4)",
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingTop: 6,
          paddingBottom: insets.bottom > 0 ? 4 : 12,
        },
        tabBarActiveTintColor: colorPalette.primary500,
        tabBarInactiveTintColor: colorPalette.neutral400,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "600",
          letterSpacing: 0.3,
          marginTop: 2,
        },
        sceneStyle: { backgroundColor: colorPalette.neutral1000 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: (p) => (
            <TabIcon {...p} focusedName="home" unfocusedName="home-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="train"
        options={{
          title: "Train",
          headerShown: false,
          tabBarIcon: (p) => (
            <TabIcon
              {...p}
              focusedName="barbell"
              unfocusedName="barbell-outline"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="fuel"
        options={{
          title: "Fuel",
          headerShown: false,
          tabBarIcon: (p) => (
            <TabIcon
              {...p}
              focusedName="restaurant"
              unfocusedName="restaurant-outline"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: "You",
          headerShown: false,
          tabBarIcon: (p) => (
            <TabIcon
              {...p}
              focusedName="stats-chart"
              unfocusedName="stats-chart-outline"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: "Clients",
          // M10.5 Wave 2 gate preserved transitionally; 14.4 swaps to
          // coach-mode visibility.
          href: isTrainerTier ? undefined : null,
          tabBarIcon: (p) => (
            <TabIcon
              {...p}
              focusedName="people"
              unfocusedName="people-outline"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="programs"
        options={{
          title: "Programs",
          // Coach-mode only — hidden until 14.4 wires mode-driven visibility.
          href: null,
          tabBarIcon: (p) => (
            <TabIcon
              {...p}
              focusedName="albums"
              unfocusedName="albums-outline"
            />
          ),
        }}
      />
    </Tabs>
  );
}
