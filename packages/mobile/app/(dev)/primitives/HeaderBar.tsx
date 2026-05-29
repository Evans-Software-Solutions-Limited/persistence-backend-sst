import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import { HeaderBar } from "@/ui/components/foundation/HeaderBar";
import { IconBtn } from "@/ui/components/foundation/IconBtn";
import { IconBell, IconCalendar, iconDefaults } from "@/ui/components/icons";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

/** /dev/primitives/HeaderBar — compact + large variants (STORY-009). */
export default function HeaderBarDevRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "HeaderBar" }} />
      <Screen scroll testID="dev-primitive-HeaderBar">
        <View paddingVertical="$lg" gap="$2xl">
          <View paddingHorizontal="$base">
            <Text variant="caption" muted>
              COMPACT (centred title + slots)
            </Text>
          </View>
          <HeaderBar
            title="Workout Detail"
            leading={
              <IconBtn
                onPress={() => undefined}
                accessibilityLabel="Back"
                icon={<IconCalendar {...iconDefaults({ size: 18 })} />}
              />
            }
            trailing={
              <IconBtn
                onPress={() => undefined}
                accessibilityLabel="Notifications"
                icon={<IconBell {...iconDefaults({ size: 18 })} />}
              />
            }
          />

          <View paddingHorizontal="$base">
            <Text variant="caption" muted>
              LARGE (eyebrow + display title + sub)
            </Text>
          </View>
          <HeaderBar
            large
            eyebrow="MONDAY · MAR 25"
            title="Fuel"
            sub="2 meals logged · 1,420 kcal"
            trailing={
              <IconBtn
                onPress={() => undefined}
                accessibilityLabel="Calendar"
                icon={<IconCalendar {...iconDefaults({ size: 18 })} />}
              />
            }
          />

          <HeaderBar large eyebrow="LIFETIME · 184 WORKOUTS" title="You" />
        </View>
      </Screen>
    </>
  );
}
