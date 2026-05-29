import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import { MultiRing, Ring } from "@/ui/components/foundation/Ring";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

/** /dev/primitives/Ring — single rings + a 3-ring MultiRing (STORY-009). */
export default function RingDevRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Ring / MultiRing" }} />
      <Screen scroll padded testID="dev-primitive-Ring">
        <View paddingVertical="$lg" gap="$xl">
          <Text variant="caption" muted>
            SINGLE RING — PERCENTS
          </Text>
          <View flexDirection="row" gap="$base" flexWrap="wrap">
            {[0.25, 0.5, 0.75, 1].map((pct) => (
              <Ring key={pct} pct={pct} accessibilityLabel={`${pct * 100}%`}>
                <Text variant="stat-md">{Math.round(pct * 100)}</Text>
              </Ring>
            ))}
          </View>

          <Text variant="caption" muted>
            COLOURS + GLOW
          </Text>
          <View flexDirection="row" gap="$base" flexWrap="wrap">
            <Ring pct={0.7} color="#34D399" glow />
            <Ring pct={0.6} color="#F5C518" glow />
            <Ring pct={0.5} color="#FB923C" glow />
          </View>

          <Text variant="caption" muted>
            MULTIRING (Move / Train / Fuel)
          </Text>
          <MultiRing
            size={140}
            accessibilityLabel="Today rings"
            rings={[
              { pct: 0.74, color: "#22D3EE" },
              { pct: 0.42, color: "#FB923C" },
              { pct: 0.88, color: "#F5C518" },
            ]}
          >
            <Text variant="stat-lg">74</Text>
            <Text variant="caption" muted>
              TODAY
            </Text>
          </MultiRing>
        </View>
      </Screen>
    </>
  );
}
