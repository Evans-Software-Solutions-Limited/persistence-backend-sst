import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import { Pill, type PillSize } from "@/ui/components/foundation/Pill";
import type { PillTone } from "@/ui/components/foundation/tones";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

const TONES: PillTone[] = [
  "neutral",
  "primary",
  "gold",
  "trainer",
  "ember",
  "success",
  "error",
];
const SIZES: PillSize[] = ["xs", "sm", "md"];

/** /dev/primitives/Pill — tone × size inventory + filled row (STORY-009). */
export default function PillDevRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Pill" }} />
      <Screen scroll padded testID="dev-primitive-Pill">
        <View paddingVertical="$lg" gap="$xl">
          {SIZES.map((size) => (
            <View key={size} gap="$sm">
              <Text variant="caption" muted>
                SIZE {size.toUpperCase()}
              </Text>
              <View flexDirection="row" flexWrap="wrap" gap="$sm">
                {TONES.map((tone) => (
                  <Pill key={tone} tone={tone} size={size}>
                    {tone}
                  </Pill>
                ))}
              </View>
            </View>
          ))}

          <Text variant="caption" muted>
            FILLED
          </Text>
          <View flexDirection="row" flexWrap="wrap" gap="$sm">
            {TONES.map((tone) => (
              <Pill key={tone} tone={tone} filled>
                {tone}
              </Pill>
            ))}
          </View>
        </View>
      </Screen>
    </>
  );
}
