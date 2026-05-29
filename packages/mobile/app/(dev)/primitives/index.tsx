import { View } from "@tamagui/core";
import { Link, Stack } from "expo-router";

import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

/**
 * /dev/primitives — landing route listing every design-system primitive
 * (01-design-system STORY-009 / tasks.md T-1.8.2). Each entry links to that
 * primitive's inventory route, which ships in the primitive's own PR.
 */
const FOUNDATION = [
  "Card",
  "Btn",
  "Pill",
  "IconBtn",
  "Avatar",
  "Bar",
  "Ring",
  "Stat",
  "Segmented",
  "TabBar",
  "HeaderBar",
  "BottomSheet",
] as const;

const COMPOSITE = [
  "Section",
  "DrawerRow",
  "MicroPill",
  "RingLegend",
  "PRCard",
  "SummaryChip",
  "ClientRow",
  "WorkoutCarouselCard",
  "HabitTile",
  "SearchBar",
] as const;

function PrimitiveLink({ name }: { name: string }) {
  return (
    <Link href={`/(dev)/primitives/${name}` as never} asChild>
      <View
        testID={`dev-primitive-link-${name}`}
        backgroundColor="$surface2"
        borderColor="$border"
        borderWidth={1}
        borderRadius="$md"
        paddingVertical="$md"
        paddingHorizontal="$base"
        pressStyle={{ opacity: 0.7 }}
      >
        <Text variant="label">{name}</Text>
      </View>
    </Link>
  );
}

export default function PrimitivesIndexRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Primitives" }} />
      <Screen scroll padded testID="dev-primitives-index">
        <View paddingVertical="$lg" gap="$xl">
          <View gap="$sm">
            <Text variant="caption" muted>
              FOUNDATION · 12
            </Text>
            {FOUNDATION.map((name) => (
              <PrimitiveLink key={name} name={name} />
            ))}
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              COMPOSITE · 10
            </Text>
            {COMPOSITE.map((name) => (
              <PrimitiveLink key={name} name={name} />
            ))}
            <Link href={"/(dev)/primitives/composites" as never} asChild>
              <View
                testID="dev-primitive-link-composites"
                backgroundColor="$surface2"
                borderColor="$border"
                borderWidth={1}
                borderRadius="$md"
                paddingVertical="$md"
                paddingHorizontal="$base"
                pressStyle={{ opacity: 0.7 }}
              >
                <Text variant="label">composites (all-in-one)</Text>
              </View>
            </Link>
          </View>
        </View>
      </Screen>
    </>
  );
}
