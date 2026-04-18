import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { colorPalette } from "../../../src/ui/theme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

type TabIconProps = {
  focused: boolean;
  color: string;
  size: number;
  focusedName: IoniconName;
  unfocusedName: IoniconName;
};

function TabIcon({
  focused,
  color,
  size,
  focusedName,
  unfocusedName,
}: TabIconProps) {
  return (
    <Ionicons
      name={focused ? focusedName : unfocusedName}
      color={color}
      size={size}
    />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colorPalette.neutral1000 },
        headerTintColor: colorPalette.neutral0,
        headerTitleStyle: { fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: colorPalette.neutral1000,
          borderTopColor: colorPalette.neutral800,
          borderTopWidth: 1,
          height: 84,
          paddingTop: 8,
          paddingBottom: 28,
        },
        tabBarActiveTintColor: colorPalette.primary500,
        tabBarInactiveTintColor: colorPalette.neutral400,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          letterSpacing: 0.3,
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
              focusedName="stats-chart"
              unfocusedName="stats-chart-outline"
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
      <Tabs.Screen
        name="exercises"
        options={{
          title: "Exercises",
          headerShown: false,
          tabBarIcon: (p) => (
            <TabIcon
              {...p}
              focusedName="library"
              unfocusedName="library-outline"
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
              focusedName="person"
              unfocusedName="person-outline"
            />
          ),
        }}
      />
    </Tabs>
  );
}
