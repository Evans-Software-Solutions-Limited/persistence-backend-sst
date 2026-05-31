import { View } from "@tamagui/core";
import { Stack } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";

import { Btn } from "@/ui/components/foundation/Btn";
import { Pill } from "@/ui/components/foundation/Pill";
import { DrawerRow } from "@/ui/components/composite/DrawerRow";
import { MicroPill } from "@/ui/components/composite/MicroPill";
import { ClientRow } from "@/ui/components/composite/ClientRow";
import { HabitTile } from "@/ui/components/composite/HabitTile";
import { PRCard } from "@/ui/components/composite/PRCard";
import { RingLegend } from "@/ui/components/composite/RingLegend";
import { SearchBar } from "@/ui/components/composite/SearchBar";
import { Section } from "@/ui/components/composite/Section";
import { SummaryChip } from "@/ui/components/composite/SummaryChip";
import { WorkoutCarouselCard } from "@/ui/components/composite/WorkoutCarouselCard";
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
  const [search, setSearch] = useState("");
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
              PR CARD (180pt gold carousel tile, medal watermark)
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View flexDirection="row" gap="$sm">
                <PRCard
                  exerciseName="Bench Press"
                  value="85"
                  unit="kg"
                  delta="+5"
                  date="2 days ago"
                />
                <PRCard
                  exerciseName="Squat"
                  value="120"
                  unit="kg"
                  delta="+2.5"
                  date="5 days ago"
                />
                <PRCard
                  exerciseName="Deadlift"
                  value="200"
                  unit="kg"
                  date="1 week ago"
                  loading
                />
              </View>
            </ScrollView>
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              SUMMARY CHIP (Trainer Clients summary row)
            </Text>
            <View flexDirection="row" gap="$sm">
              <SummaryChip count={8} label="Active" tone="success" />
              <SummaryChip count={3} label="Need attention" tone="ember" />
              <SummaryChip count={2} label="New PRs" tone="gold" />
            </View>
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              CLIENT ROW (Trainer Clients list)
            </Text>
            <ClientRow
              avatar={{ initials: "JD", tone: "primary" }}
              name="Jane Doe"
              status="pr"
              tags="Hypertrophy"
              lastSeen="2 days"
              adherence={92}
              onPress={() => undefined}
            />
            <ClientRow
              avatar={{ initials: "MS", tone: "gold" }}
              name="Mark Smith"
              status="attention"
              tags="Strength"
              lastSeen="5 days"
              adherence={64}
              onPress={() => undefined}
            />
            <ClientRow
              avatar={{ initials: "AB" }}
              name="Alex Brown"
              status="missed"
              adherence={38}
              isLast
              onPress={() => undefined}
            />
            <ClientRow avatar={{ initials: "LD" }} name="Loading" loading />
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              WORKOUT CAROUSEL CARD (260pt fixed, primary highlight)
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View flexDirection="row" gap="$sm">
                <WorkoutCarouselCard
                  title="Push Day"
                  mins={45}
                  sub="Chest, shoulders, triceps — 6 exercises"
                  chips={["Push", "Hypertrophy"]}
                  primary
                  onPress={() => undefined}
                />
                <WorkoutCarouselCard
                  title="Pull Day"
                  mins={50}
                  sub="Back, biceps — 7 exercises"
                  chips={["Pull"]}
                  onPress={() => undefined}
                />
                <WorkoutCarouselCard
                  title="Loading"
                  mins={0}
                  sub=""
                  chips={[]}
                  loading
                />
              </View>
            </ScrollView>
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              HABIT TILE (done / today / missed / locked)
            </Text>
            <View flexDirection="row" gap="$sm" alignItems="center">
              <HabitTile
                state="done"
                tone="primary"
                label="Workout"
                onPress={() => undefined}
              />
              <HabitTile
                state="done"
                tone="gold"
                label="Protein"
                onPress={() => undefined}
              />
              <HabitTile
                state="today"
                tone="primary"
                label="Water"
                onPress={() => undefined}
              />
              <HabitTile
                state="missed"
                tone="success"
                label="Sleep"
                onPress={() => undefined}
              />
              <HabitTile state="locked" tone="trainer" label="Future" />
            </View>
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              SEARCH BAR (40pt input + leading icon)
            </Text>
            <SearchBar
              placeholder="Search exercises"
              value={search}
              onChangeText={setSearch}
            />
          </View>
        </View>
      </Screen>
    </>
  );
}
