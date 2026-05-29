import { View } from "@tamagui/core";
import { Stack } from "expo-router";
import { useState } from "react";

import { Segmented } from "@/ui/components/foundation/Segmented";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

/** /dev/primitives/Segmented — 2-5 options, accents, sizes (STORY-009). */
export default function SegmentedDevRoute() {
  const [two, setTwo] = useState("Workouts");
  const [three, setThree] = useState("all");
  const [five, setFive] = useState("a");
  const [gold, setGold] = useState("x");

  return (
    <>
      <Stack.Screen options={{ title: "Segmented" }} />
      <Screen scroll padded testID="dev-primitive-Segmented">
        <View paddingVertical="$lg" gap="$xl">
          <Text variant="caption" muted>
            TWO OPTIONS (Train hub)
          </Text>
          <Segmented
            options={["Workouts", "Exercises"]}
            value={two}
            onChange={setTwo}
          />

          <Text variant="caption" muted>
            THREE OPTIONS (Clients: Active / All / Archive)
          </Text>
          <Segmented
            options={[
              { value: "active", label: "Active" },
              { value: "all", label: "All" },
              { value: "archive", label: "Archive" },
            ]}
            value={three}
            onChange={setThree}
            accent="trainer"
          />

          <Text variant="caption" muted>
            FIVE OPTIONS (auto-scroll on narrow viewport)
          </Text>
          <Segmented
            options={["a", "b", "c", "d", "e"]}
            value={five}
            onChange={setFive}
          />

          <Text variant="caption" muted>
            GOLD ACCENT · SM SIZE
          </Text>
          <Segmented
            options={["x", "y"]}
            value={gold}
            onChange={setGold}
            accent="gold"
            size="sm"
          />
        </View>
      </Screen>
    </>
  );
}
