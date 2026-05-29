import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import { IconBtn, type IconBtnTone } from "@/ui/components/foundation/IconBtn";
import {
  IconBell,
  IconChevronR,
  IconMore,
  IconPlus,
  iconDefaults,
} from "@/ui/components/icons";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

const TONES: IconBtnTone[] = [
  "neutral",
  "ghost",
  "primary",
  "gold",
  "trainer",
  "ember",
  "success",
  "error",
];

/** /dev/primitives/IconBtn — tone inventory + active + sizes + nest-safe View. */
export default function IconBtnDevRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "IconBtn" }} />
      <Screen scroll padded testID="dev-primitive-IconBtn">
        <View paddingVertical="$lg" gap="$xl">
          <Text variant="caption" muted>
            TONES (pressable)
          </Text>
          <View flexDirection="row" flexWrap="wrap" gap="$sm">
            {TONES.map((tone) => (
              <IconBtn
                key={tone}
                tone={tone}
                onPress={() => undefined}
                accessibilityLabel={`${tone} action`}
                icon={<IconBell {...iconDefaults({ size: 18 })} />}
              />
            ))}
          </View>

          <Text variant="caption" muted>
            ACTIVE
          </Text>
          <IconBtn
            active
            onPress={() => undefined}
            accessibilityLabel="Active"
            icon={<IconBell {...iconDefaults({ size: 18, active: true })} />}
          />

          <Text variant="caption" muted>
            SIZES 28 / 36 / 44
          </Text>
          <View flexDirection="row" gap="$sm" alignItems="center">
            {[28, 36, 44].map((size) => (
              <IconBtn
                key={size}
                size={size}
                onPress={() => undefined}
                accessibilityLabel={`size ${size}`}
                icon={<IconPlus {...iconDefaults({ size: 18 })} />}
              />
            ))}
          </View>

          <Text variant="caption" muted>
            NON-PRESSABLE (nest-safe View)
          </Text>
          <View flexDirection="row" gap="$sm">
            <IconBtn
              accessibilityLabel="Chevron"
              icon={<IconChevronR {...iconDefaults({ size: 18 })} />}
            />
            <IconBtn
              tone="primary"
              accessibilityLabel="More"
              icon={<IconMore {...iconDefaults({ size: 18 })} />}
            />
          </View>
        </View>
      </Screen>
    </>
  );
}
