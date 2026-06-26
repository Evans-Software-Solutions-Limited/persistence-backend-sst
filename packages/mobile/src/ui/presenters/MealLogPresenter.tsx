import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
import { Card, IconBtn } from "@/ui/components/foundation";
import { IconPlus } from "@/ui/components/icons";
import type { MealSlot } from "@/domain/models/nutrition";

/**
 * <MealLogPresenter> — the four meal sections (Breakfast/Lunch/Snack/Dinner),
 * each a <Card> with a header (name + kcal sub + Add) and its entry rows (or an
 * empty state). nutrition.jsx:107–164.
 *
 * Pure: rows + handlers are props. The container resolves each entry's display
 * name from the local caches (the backend aggregate carries no name) and sums
 * the per-slot kcal.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <MealLogPresenter>
 */

export type MealRowVM = {
  id: string;
  name: string;
  /** e.g. "1 serving" — secondary line. */
  sub: string;
  kcal: number;
};

export type MealSlotVM = {
  slot: MealSlot;
  label: string;
  kcal: number;
  rows: readonly MealRowVM[];
};

export type MealLogProps = {
  slots: readonly MealSlotVM[];
  onAddToSlot: (slot: MealSlot) => void;
  /** Tap a logged row to edit it (optional in M9 — wired to the edit sheet). */
  onPressRow?: (id: string, slot: MealSlot) => void;
  testID?: string;
};

const intl = (n: number) => Math.round(n).toLocaleString("en-US");

function MealRow({
  row,
  slot,
  onPressRow,
}: {
  row: MealRowVM;
  slot: MealSlot;
  onPressRow?: (id: string, slot: MealSlot) => void;
}) {
  return (
    <Pressable
      testID={`fuel-entry-${row.id}`}
      onPress={onPressRow ? () => onPressRow(row.id, slot) : undefined}
      accessibilityRole={onPressRow ? "button" : undefined}
      style={({ pressed }) => ({ opacity: pressed && onPressRow ? 0.7 : 1 })}
    >
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingVertical={8}
        paddingHorizontal={14}
        borderTopWidth={1}
        borderColor="$border"
      >
        <View flex={1} paddingRight={10}>
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text"
            numberOfLines={1}
          >
            {row.name}
          </Text>
          <Text
            fontFamily="$mono"
            fontSize={11}
            color="$text3"
            fontVariant={["tabular-nums"]}
          >
            {row.sub}
          </Text>
        </View>
        <Text
          fontFamily="$mono"
          fontSize={12}
          color="$text2"
          fontVariant={["tabular-nums"]}
        >
          {intl(row.kcal)} kcal
        </Text>
      </View>
    </Pressable>
  );
}

export function MealLogPresenter({
  slots,
  onAddToSlot,
  onPressRow,
  testID = "fuel-meal-log",
}: MealLogProps) {
  return (
    <View gap={10} testID={testID}>
      <Text
        fontFamily="$display"
        fontWeight="700"
        fontSize={24}
        letterSpacing={-0.5}
        color="$text"
        paddingHorizontal={2}
      >
        Today&apos;s log
      </Text>
      {slots.map((m) => (
        <Card key={m.slot} pad={0} radius={14} testID={`fuel-slot-${m.slot}`}>
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            paddingVertical={12}
            paddingHorizontal={14}
          >
            <View flexDirection="row" alignItems="center" gap={10}>
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={14}
                color="$text"
              >
                {m.label}
              </Text>
              <Text
                fontFamily="$mono"
                fontSize={11}
                color="$text3"
                fontVariant={["tabular-nums"]}
              >
                {intl(m.kcal)} kcal
              </Text>
            </View>
            <IconBtn
              size={28}
              tone="primary"
              icon={<IconPlus size={16} strokeWidth={2.2} />}
              onPress={() => onAddToSlot(m.slot)}
              testID={`fuel-slot-add-${m.slot}`}
              accessibilityLabel={`Add to ${m.label}`}
            />
          </View>
          {m.rows.length > 0 ? (
            m.rows.map((row) => (
              <MealRow
                key={row.id}
                row={row}
                slot={m.slot}
                onPressRow={onPressRow}
              />
            ))
          ) : (
            <View
              paddingHorizontal={14}
              paddingTop={10}
              paddingBottom={12}
              borderTopWidth={1}
              borderColor="$border"
            >
              <Text fontFamily="$body" fontSize={12} color="$text3">
                Nothing logged yet
              </Text>
            </View>
          )}
        </Card>
      ))}
    </View>
  );
}
