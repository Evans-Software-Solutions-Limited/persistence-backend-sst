import { View } from "@tamagui/core";
import { Stack } from "expo-router";

import { Btn } from "@/ui/components/foundation/Btn";
import { Pill } from "@/ui/components/foundation/Pill";
import { DrawerRow } from "@/ui/components/composite/DrawerRow";
import { MicroPill } from "@/ui/components/composite/MicroPill";
import { PRCard } from "@/ui/components/composite/PRCard";
import { RingLegend } from "@/ui/components/composite/RingLegend";
import { Section } from "@/ui/components/composite/Section";
import {
  IconBolt,
  IconDroplet,
  IconFlame,
  IconSettings,
  IconUser,
  iconDefaults,
} from "@/ui/components/icons";
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

          <View gap="$sm">
            <Text variant="caption" muted>
              MICRO PILL (TodayHero 4-up row)
            </Text>
            <View flexDirection="row" gap="$sm">
              <MicroPill
                tone="primary"
                value="12"
                label="Streak"
                icon={
                  <IconFlame {...iconDefaults({ size: 16 })} color="#22D3EE" />
                }
              />
              <MicroPill
                tone="ember"
                value="2.4L"
                label="Water"
                icon={
                  <IconDroplet
                    {...iconDefaults({ size: 16 })}
                    color="#FB923C"
                  />
                }
              />
              <MicroPill
                tone="gold"
                value="14.2"
                label="Strain"
                icon={
                  <IconBolt {...iconDefaults({ size: 16 })} color="#F5C518" />
                }
              />
            </View>
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              RING LEGEND (TodayHero legend column)
            </Text>
            <RingLegend
              color="#22D3EE"
              label="Move"
              value="540"
              sub="cal"
              pct={0.74}
            />
            <RingLegend
              color="#FB923C"
              label="Train"
              value="12.4k"
              sub="kg"
              pct={0.42}
            />
            <RingLegend
              color="#F5C518"
              label="Fuel"
              value="1,820"
              sub="kcal"
              pct={0.88}
            />
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              PR CARD (gold-tinted, medal)
            </Text>
            <PRCard
              exerciseName="Bench Press"
              newValue="120 KG × 5"
              previousValue="115 KG × 5"
              delta={{ value: 5, unit: "kg" }}
              achievedAt={new Date()}
            />
            <PRCard
              exerciseName="Deadlift"
              newValue="200 KG × 1"
              achievedAt={new Date()}
              loading
            />
          </View>
        </View>
      </Screen>
    </>
  );
}
