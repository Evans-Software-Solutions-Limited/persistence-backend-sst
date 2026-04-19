import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colorPalette } from "../../../src/ui/theme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

type TabIconProps = {
  focused: boolean;
  color: string;
  size: number;
  focusedName: IoniconName;
  unfocusedName: IoniconName;
};

/**
 * Tab icon with a primary-coloured top indicator bar (2pt × 24pt) that
 * shows only on the active tab. The indicator is the tab bar's signature
 * moment — most apps settle for colour-only feedback. It sits above the
 * icon (absolutely positioned) so it doesn't affect layout height.
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
  // Let the bar grow naturally with the safe-area bottom inset rather than
  // hardcoding 84pt. Phones without a home indicator get ~72pt; phones with
  // one get ~94pt — both feel right for their device.
  const tabBarHeight = 60 + insets.bottom;

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
          tabBarIcon: (p) => (
            <TabIcon {...p} focusedName="home" unfocusedName="home-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: "Progress",
          tabBarIcon: (p) => (
            <TabIcon
              {...p}
              focusedName="trending-up"
              unfocusedName="trending-up-outline"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="workouts"
        options={{
          title: "Workouts",
          tabBarIcon: (p) => (
            <TabIcon
              {...p}
              focusedName="barbell"
              unfocusedName="barbell-outline"
            />
          ),
        }}
      />
      {/*
        `exercises` here refers to the flat `exercises.tsx` file in this
        directory — the browse tab. Its detail / creator / filters sub-routes
        live at `app/(app)/exercises/*` (sibling of this `(tabs)` group), NOT
        under a nested `exercises/` directory here. That positioning makes
        them push OVER the tab bar instead of rendering inside it. See
        `app/(app)/_layout.tsx` for the full tree.
      */}
      <Tabs.Screen
        name="exercises"
        options={{
          title: "Exercises",
          headerShown: false,
          tabBarIcon: (p) => (
            <TabIcon
              {...p}
              focusedName="albums"
              unfocusedName="albums-outline"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: (p) => (
            <TabIcon
              {...p}
              focusedName="person-circle"
              unfocusedName="person-circle-outline"
            />
          ),
        }}
      />
    </Tabs>
  );
}
