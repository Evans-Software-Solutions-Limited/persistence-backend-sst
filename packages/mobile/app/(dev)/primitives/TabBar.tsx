import { View } from "@tamagui/core";
import { Stack } from "expo-router";
import { useState } from "react";

import { TabBar, type TabSpec } from "@/ui/components/foundation/TabBar";
import {
  IconApple,
  IconChart,
  IconDumbbell,
  IconHome,
  IconUsers,
} from "@/ui/components/icons";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

const ATHLETE: TabSpec[] = [
  { id: "home", icon: IconHome, label: "Home" },
  { id: "train", icon: IconDumbbell, label: "Train" },
  { id: "fuel", icon: IconApple, label: "Fuel" },
  { id: "you", icon: IconChart, label: "You" },
];

const COACH: TabSpec[] = [
  { id: "home", icon: IconHome, label: "Home" },
  { id: "clients", icon: IconUsers, label: "Clients", badge: "3" },
  { id: "programs", icon: IconChart, label: "Programs" },
  { id: "you", icon: IconChart, label: "You" },
];

/** /dev/primitives/TabBar — athlete + coach mode bars (STORY-009). */
export default function TabBarDevRoute() {
  const [athleteActive, setAthleteActive] = useState("home");
  const [coachActive, setCoachActive] = useState("clients");

  return (
    <>
      <Stack.Screen options={{ title: "TabBar" }} />
      <Screen scroll testID="dev-primitive-TabBar">
        <View paddingVertical="$lg" gap="$xl">
          <View paddingHorizontal="$base" gap="$sm">
            <Text variant="caption" muted>
              ATHLETE MODE (cyan accent)
            </Text>
          </View>
          <TabBar
            tabs={ATHLETE}
            active={athleteActive}
            onChange={setAthleteActive}
          />

          <View paddingHorizontal="$base" gap="$sm" marginTop="$2xl">
            <Text variant="caption" muted>
              COACH MODE (violet accent + COACH dot + badge)
            </Text>
          </View>
          <TabBar
            tabs={COACH}
            active={coachActive}
            mode="coach"
            onChange={setCoachActive}
          />
        </View>
      </Screen>
    </>
  );
}
