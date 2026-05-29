import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import { Card } from "@/ui/components/foundation/Card";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

/**
 * /dev/primitives/Card — inventory of every Card variant (01-design-system
 * STORY-009 AC 9.2). Open beside the design-system standalone HTML to confirm
 * 1:1 parity.
 */
const ACCENTS = [
  "primary",
  "gold",
  "trainer",
  "ember",
  "success",
  "error",
] as const;
const GLOWS = ["primary", "gold", "trainer"] as const;

export default function CardDevRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Card" }} />
      <Screen scroll padded testID="dev-primitive-Card">
        <View paddingVertical="$lg" gap="$lg">
          <Text variant="caption" muted>
            SURFACE TIERS
          </Text>
          {[0, 1, 2].map((surface) => (
            <Card key={surface} surface={surface as 0 | 1 | 2}>
              <Text variant="label">surface={surface}</Text>
            </Card>
          ))}

          <Text variant="caption" muted>
            ACCENT BORDERS
          </Text>
          {ACCENTS.map((accent) => (
            <Card key={accent} accent={accent}>
              <Text variant="label">accent={accent}</Text>
            </Card>
          ))}

          <Text variant="caption" muted>
            GLOW RINGS
          </Text>
          {GLOWS.map((glow) => (
            <Card key={glow} glow={glow}>
              <Text variant="label">glow={glow}</Text>
            </Card>
          ))}

          <Text variant="caption" muted>
            PRESSABLE
          </Text>
          <Card onPress={() => undefined} accessibilityLabel="Pressable card">
            <Text variant="label">onPress (tap me)</Text>
          </Card>

          <Text variant="caption" muted>
            CUSTOM PAD + RADIUS
          </Text>
          <Card pad={24} radius={28}>
            <Text variant="label">pad=24 radius=28</Text>
          </Card>
        </View>
      </Screen>
    </>
  );
}
