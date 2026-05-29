import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import { Btn } from "@/ui/components/foundation/Btn";
import { Pill } from "@/ui/components/foundation/Pill";
import { DrawerRow } from "@/ui/components/composite/DrawerRow";
import { Section } from "@/ui/components/composite/Section";
import { IconSettings, IconUser, iconDefaults } from "@/ui/components/icons";
import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

/**
 * /dev/primitives/composites — one usage example of each composite primitive
 * (01-design-system STORY-009 AC 9.4 / tasks.md T-1.8.4). Rows are added as
 * each composite lands in its own PR.
 */
export default function CompositesDevRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Composites" }} />
      <Screen scroll padded testID="dev-primitive-composites">
        <View paddingVertical="$lg" gap="$2xl">
          <View gap="$sm">
            <Text variant="caption" muted>
              SECTION
            </Text>
            <Section
              eyebrow="TODAY"
              title="Workouts"
              action={
                <Btn
                  variant="ghost"
                  tone="primary"
                  size="sm"
                  onPress={() => undefined}
                >
                  See all
                </Btn>
              }
            >
              <Text variant="body">Section body content goes here.</Text>
            </Section>
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              DRAWER ROW
            </Text>
            <DrawerRow
              icon={
                <IconUser {...iconDefaults({ size: 18 })} color="#C2C2CE" />
              }
              title="Profile details"
              sub="Name, email, photo"
              onPress={() => undefined}
            />
            <DrawerRow
              icon={
                <IconSettings {...iconDefaults({ size: 18 })} color="#C2C2CE" />
              }
              title="Achievements"
              trailing={<Pill tone="gold">12</Pill>}
              onPress={() => undefined}
            />
            <DrawerRow
              icon={
                <IconUser {...iconDefaults({ size: 18 })} color="#C2C2CE" />
              }
              title="Loading row"
              sub="placeholder"
              loading
            />
          </View>
        </View>
      </Screen>
    </>
  );
}
