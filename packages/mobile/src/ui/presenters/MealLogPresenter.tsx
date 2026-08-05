import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { Btn, Card, IconBtn, Pill } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconPlus, IconSparkles, IconTrash } from "@/ui/components/icons";
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
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/**
 * A planned-but-unlogged meal-plan meal, mapped to this slot (spec-26 Phase
 * 2, AC 5.1) — the "ghost row". Rendered as a dashed, gold-tinted row with a
 * "Log it" action, distinct from a real logged entry.
 */
export type MealGhostRowVM = {
  planId: string;
  planMealId: string;
  label: string;
  kcal: number;
};

export type MealSlotVM = {
  slot: MealSlot;
  label: string;
  kcal: number;
  rows: readonly MealRowVM[];
  /** Planned-but-unlogged plan meals mapped to this slot. Empty when there's
   * no active plan, or every plan meal in this slot is already logged. */
  ghostRows?: readonly MealGhostRowVM[];
};

export type MealLogProps = {
  slots: readonly MealSlotVM[];
  onAddToSlot: (slot: MealSlot) => void;
  /** Tap a logged row to edit it (optional in M9 — wired to the edit sheet). */
  onPressRow?: (id: string, slot: MealSlot) => void;
  /** Swipe a logged row left to reveal Delete; tap it to remove the entry. */
  onDeleteEntry?: (id: string, slot: MealSlot) => void;
  /** "Log it" on a ghost row (spec-26 AC 5.2) — omit to render ghost rows read-only. */
  onLogGhost?: (planId: string, planMealId: string, slot: MealSlot) => void;
  testID?: string;
};

const intl = (n: number) => Math.round(n).toLocaleString("en-US");

/** The red "Delete" panel revealed by a left-swipe on a logged entry row. */
function DeleteAction({ id, onDelete }: { id: string; onDelete: () => void }) {
  return (
    <Pressable
      testID={`fuel-entry-delete-${id}`}
      onPress={onDelete}
      accessibilityRole="button"
      accessibilityLabel="Delete entry"
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <View
        backgroundColor="$error"
        width={88}
        height="100%"
        alignItems="center"
        justifyContent="center"
        gap={3}
      >
        <IconTrash size={18} color="#fff" strokeWidth={2.2} />
        <Text fontFamily="$body" fontSize={11} fontWeight="700" color="#fff">
          Delete
        </Text>
      </View>
    </Pressable>
  );
}

function MealRowBody({
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
      {/* Opaque surface so the row slides over the red Delete panel on swipe. */}
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingVertical={8}
        paddingHorizontal={14}
        borderTopWidth={1}
        borderColor="$border"
        backgroundColor="$surface"
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
          <Text
            fontFamily="$mono"
            fontSize={11}
            color="$text3"
            fontVariant={["tabular-nums"]}
            testID={`fuel-entry-macros-${row.id}`}
          >
            {`P ${intl(row.proteinG)}g · C ${intl(row.carbsG)}g · F ${intl(row.fatG)}g`}
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

function MealRow({
  row,
  slot,
  onPressRow,
  onDeleteEntry,
}: {
  row: MealRowVM;
  slot: MealSlot;
  onPressRow?: (id: string, slot: MealSlot) => void;
  onDeleteEntry?: (id: string, slot: MealSlot) => void;
}) {
  const body = <MealRowBody row={row} slot={slot} onPressRow={onPressRow} />;
  if (!onDeleteEntry) return body;
  // Swipe left to reveal a destructive Delete (iOS-standard). Tapping it removes
  // the entry immediately (optimistic — re-loggable); the container owns the
  // command + reflect.
  return (
    <ReanimatedSwipeable
      testID={`fuel-entry-swipe-${row.id}`}
      renderRightActions={(_progress, _translation, methods) => (
        <DeleteAction
          id={row.id}
          onDelete={() => {
            onDeleteEntry(row.id, slot);
            methods.close();
          }}
        />
      )}
      rightThreshold={40}
      overshootRight={false}
    >
      {body}
    </ReanimatedSwipeable>
  );
}

const GOLD = toneHex("gold");

/**
 * A planned-but-unlogged meal (spec-26 AC 5.1) — dashed gold-tinted row, "Log
 * it" writes it through `useLogPlanMeal` (offline-queueable, AC 5.2). Kept
 * visually distinct from a real logged row (opaque `$surface`, solid border):
 * this is an OFFER, not a fact about what was eaten.
 */
function GhostRow({
  ghost,
  slot,
  onLogGhost,
}: {
  ghost: MealGhostRowVM;
  slot: MealSlot;
  onLogGhost?: (planId: string, planMealId: string, slot: MealSlot) => void;
}) {
  return (
    <View
      testID={`fuel-ghost-${ghost.planMealId}`}
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      gap={10}
      paddingVertical={8}
      paddingHorizontal={14}
      borderTopWidth={1}
      borderColor="$border"
      backgroundColor="transparent"
    >
      <View flexDirection="row" alignItems="center" gap={8} flex={1}>
        <IconSparkles size={13} color={GOLD.base} />
        <View flex={1}>
          <Pill tone="gold" size="xs">
            PLANNED
          </Pill>
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text2"
            numberOfLines={1}
            marginTop={2}
          >
            {ghost.label} · {Math.round(ghost.kcal)} kcal
          </Text>
        </View>
      </View>
      {onLogGhost ? (
        <Btn
          variant="soft"
          tone="gold"
          size="sm"
          icon={<IconPlus size={11} strokeWidth={2.5} />}
          onPress={() => onLogGhost(ghost.planId, ghost.planMealId, slot)}
          testID={`fuel-ghost-log-${ghost.planMealId}`}
        >
          Log it
        </Btn>
      ) : null}
    </View>
  );
}

export function MealLogPresenter({
  slots,
  onAddToSlot,
  onPressRow,
  onDeleteEntry,
  onLogGhost,
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
                onDeleteEntry={onDeleteEntry}
              />
            ))
          ) : (m.ghostRows?.length ?? 0) === 0 ? (
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
          ) : null}
          {(m.ghostRows ?? []).map((ghost) => (
            <GhostRow
              key={ghost.planMealId}
              ghost={ghost}
              slot={m.slot}
              onLogGhost={onLogGhost}
            />
          ))}
        </Card>
      ))}
    </View>
  );
}
