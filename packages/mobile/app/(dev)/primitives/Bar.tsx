import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import { Bar } from "@/ui/components/foundation/Bar";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

/** /dev/primitives/Bar — percents, colours, heights, glow (STORY-009). */
export default function BarDevRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Bar" }} />
      <Screen scroll padded testID="dev-primitive-Bar">
        <View paddingVertical="$lg" gap="$xl">
          <Text variant="caption" muted>
            PERCENTS
          </Text>
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
            <View key={pct} gap="$xs">
              <Text variant="caption">{Math.round(pct * 100)}%</Text>
              <Bar pct={pct} accessibilityLabel={`${pct * 100} percent`} />
            </View>
          ))}

          <Text variant="caption" muted>
            COLOURS (success / gold / ember / error)
          </Text>
          <Bar pct={0.85} color="#34D399" />
          <Bar pct={0.6} color="#F5C518" />
          <Bar pct={0.45} color="#FB923C" />
          <Bar pct={0.3} color="#F87171" />

          <Text variant="caption" muted>
            HEIGHTS 4 / 6 / 10
          </Text>
          <Bar pct={0.7} height={4} />
          <Bar pct={0.7} height={6} />
          <Bar pct={0.7} height={10} />

          <Text variant="caption" muted>
            GLOW
          </Text>
          <Bar pct={0.7} glow />
        </View>
      </Screen>
    </>
  );
}
