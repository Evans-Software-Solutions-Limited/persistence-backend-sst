import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import { Stat, type StatTone } from "@/ui/components/foundation/Stat";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

const TONES: StatTone[] = ["text", "primary", "gold", "trainer", "ember"];

/** /dev/primitives/Stat — sizes, tones, units, trends (STORY-009). */
export default function StatDevRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Stat" }} />
      <Screen scroll padded testID="dev-primitive-Stat">
        <View paddingVertical="$lg" gap="$xl">
          <Text variant="caption" muted>
            SIZES md / lg / xl
          </Text>
          <View flexDirection="row" gap="$xl" alignItems="baseline">
            <Stat value={20} size="md" label="MD" />
            <Stat value={28} size="lg" label="LG" />
            <Stat value={40} size="xl" label="XL" />
          </View>

          <Text variant="caption" muted>
            TONES
          </Text>
          <View flexDirection="row" gap="$xl" flexWrap="wrap">
            {TONES.map((tone) => (
              <Stat key={tone} value={42} tone={tone} label={tone} />
            ))}
          </View>

          <Text variant="caption" muted>
            UNITS + TRENDS + SUB
          </Text>
          <Stat
            value="120"
            unit="KG"
            label="Bench PR"
            trend={8}
            sub="vs last week"
          />
          <Stat
            value="84"
            unit="KG"
            label="Bodyweight"
            trend={-2}
            sub="down 2%"
          />
          <Stat value="10:09" label="Session" tone="primary" />

          <Text variant="caption" muted>
            CENTERED (ring centre usage)
          </Text>
          <Stat value="74" unit="%" align="center" size="xl" tone="primary" />
        </View>
      </Screen>
    </>
  );
}
