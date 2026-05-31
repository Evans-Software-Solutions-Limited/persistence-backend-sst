import { View } from "@tamagui/core";
import { Link, Stack } from "expo-router";

import { Screen } from "@/ui/components/Screen";
import { Text } from "@/ui/components/Text";

/**
 * /dev/primitives — landing route listing every design-system primitive
 * (01-design-system STORY-009 / tasks.md T-1.8.2). Foundation primitives each
 * have their own inventory route; the 10 composites are consolidated into the
 * single `composites` route (T-1.8.4), so every composite row links there.
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

function PrimitiveLink({
  name,
  href,
  label,
}: {
  name: string;
  href: string;
  label?: string;
}) {
  return (
    <Link href={href as never} asChild>
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
        <Text variant="label">{label ?? name}</Text>
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
              <PrimitiveLink
                key={name}
                name={name}
                href={`/(dev)/primitives/${name}`}
              />
            ))}
          </View>

          <View gap="$sm">
            <Text variant="caption" muted>
              COMPOSITE · 10 (all on one screen)
            </Text>
            {COMPOSITE.map((name) => (
              <PrimitiveLink
                key={name}
                name={name}
                href="/(dev)/primitives/composites"
              />
            ))}
            <PrimitiveLink
              name="composites"
              href="/(dev)/primitives/composites"
              label="composites (all-in-one)"
            />
          </View>
        </View>
      </Screen>
    </>
  );
}
