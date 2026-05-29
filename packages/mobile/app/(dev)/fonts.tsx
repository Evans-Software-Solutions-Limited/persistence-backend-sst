import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

/**
 * /dev/fonts — font smoke route (01-design-system STORY-002 AC 2.5).
 *
 * Demonstrates:
 *  - Geist display weights 400-900
 *  - Geist body
 *  - Geist Mono numerics rendered via the `stat-*` Text variants (tabular
 *    figures + slashed zero). The 0 / 00 / 000 row makes the slashed zero
 *    visible for side-by-side review against the design-system standalone HTML.
 */
export default function FontsDevRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Fonts" }} />
      <Screen scroll padded testID="dev-fonts">
        <View paddingVertical="$lg" gap="$xl">
          <View gap="$sm">
            <Text variant="caption" muted>
              GEIST DISPLAY
            </Text>
            <Text
              style={{
                fontFamily: "$display",
                fontSize: 32,
                fontWeight: "900",
              }}
            >
              Persistence 900
            </Text>
            <Text
              style={{
                fontFamily: "$display",
                fontSize: 28,
                fontWeight: "700",
              }}
            >
              Persistence 700
            </Text>
            <Text
              style={{
                fontFamily: "$display",
                fontSize: 22,
                fontWeight: "600",
              }}
            >
              Persistence 600
            </Text>
            <Text
              style={{
                fontFamily: "$display",
                fontSize: 18,
                fontWeight: "400",
              }}
            >
              Persistence 400
            </Text>
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              GEIST BODY
            </Text>
            <Text variant="body">
              The quick brown fox jumps over the lazy dog. 1234567890
            </Text>
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              GEIST MONO — TABULAR + SLASHED ZERO
            </Text>
            <Text variant="stat-xl" testID="dev-fonts-zero-xl">
              0 00 000
            </Text>
            <Text variant="stat-lg" testID="dev-fonts-zero-lg">
              10:09 · 100 KG × 5
            </Text>
            <Text variant="stat-md" testID="dev-fonts-zero-md">
              1,000 · 0.0% · 00:00
            </Text>
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              TABULAR ALIGNMENT (no bounce on update)
            </Text>
            <Text variant="stat-md">11111</Text>
            <Text variant="stat-md">00000</Text>
            <Text variant="stat-md">98765</Text>
          </View>
        </View>
      </Screen>
    </>
  );
}
