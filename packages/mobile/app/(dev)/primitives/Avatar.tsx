import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import { Avatar, type AvatarTone } from "@/ui/components/foundation/Avatar";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

const TONES: AvatarTone[] = ["primary", "gold", "trainer"];

/** /dev/primitives/Avatar — tone × dot × badge × size inventory (STORY-009). */
export default function AvatarDevRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Avatar" }} />
      <Screen scroll padded testID="dev-primitive-Avatar">
        <View paddingVertical="$lg" gap="$xl">
          <Text variant="caption" muted>
            TONES
          </Text>
          <View flexDirection="row" gap="$base" alignItems="center">
            {TONES.map((tone) => (
              <Avatar key={tone} initials="BE" tone={tone} />
            ))}
          </View>

          <Text variant="caption" muted>
            STATUS DOTS
          </Text>
          <View flexDirection="row" gap="$base" alignItems="center">
            <Avatar initials="BE" dot="success" />
            <Avatar initials="BE" dot="warning" />
            <Avatar initials="BE" dot="error" />
          </View>

          <Text variant="caption" muted>
            COACH BADGE
          </Text>
          <View flexDirection="row" gap="$base" alignItems="center">
            <Avatar initials="BE" size={56} tone="trainer" badge="COACH" />
            <Avatar initials="BE" size={56} badge="COACH" />
          </View>

          <Text variant="caption" muted>
            SIZES 28 / 36 / 48 / 56
          </Text>
          <View flexDirection="row" gap="$base" alignItems="center">
            {[28, 36, 48, 56].map((size) => (
              <Avatar key={size} initials="BE" size={size} />
            ))}
          </View>

          <Text variant="caption" muted>
            PRESSABLE
          </Text>
          <Avatar initials="BE" onPress={() => undefined} />
        </View>
      </Screen>
    </>
  );
}
