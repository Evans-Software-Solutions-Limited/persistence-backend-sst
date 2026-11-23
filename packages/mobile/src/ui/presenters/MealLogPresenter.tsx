import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { Btn, Card, IconBtn, Pill } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconMore,
  IconPlus,
  IconSparkles,
  IconTrash,
} from "@/ui/components/icons";
import type { MealSlot } from "@/domain/models/nutrition";

/**
 * <MealLogPresenter> — one section per meal in "Your meals" (PER-132), each a
 * <Card> with a header (name + kcal + Add + ⋯), the per-meal macro summary
 * (canvas N1: "32g C · 21g F · 34g P"), then its entry rows (or an empty
 * state). Brad (18 Nov): keep the shipped row style; add the per-meal summary.
 * nutrition.jsx:107–164.
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
  /** PER-132: the user meal id (or a synthetic `slot:` id) — the section key. */
  key: string;
  /** The old slot this meal maps to (entries' `mealSlot`). */
  slot: MealSlot;
  label: string;
  kcal: number;
  /** "32g C · 21g F · 34g P"; empty when nothing is logged. */
  macroLine?: string;
  rows: readonly MealRowVM[];
  /** Planned-but-unlogged plan meals mapped to this slot. Empty when there's
   * no active plan, or every plan meal in this slot is already logged. */
  ghostRows?: readonly MealGhostRowVM[];
};

export type MealLogProps = {
  slots: readonly MealSlotVM[];
  /** + on a meal → the full-page Add to a meal (PER-132). */
  onAddToMeal: (mealKey: string) => void;
  /** ⋯ on a meal → its options (copy, save as a meal, edit meals, clear). */
  onMealOptions?: (mealKey: string) => void;
  /** "Add or edit meals" chip under the meals → Your meals (N1b). */
  onEditMeals?: () => void;
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
  onAddToMeal,
  onMealOptions,
  onEditMeals,
  onPressRow,
  onDeleteEntry,
  onLogGhost,
  testID = "fuel-meal-log",
}: MealLogProps) {
  return (
    <View gap={10} testID={testID}>
      {slots.map((m) => (
        <Card key={m.key} pad={0} radius={14} testID={`fuel-meal-${m.key}`}>
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            paddingVertical={12}
            paddingHorizontal={14}
          >
            <View flex={1} paddingRight={8}>
              <View flexDirection="row" alignItems="center" gap={10}>
                <Text
                  fontFamily="$display"
                  fontWeight="700"
                  fontSize={14}
                  color="$text"
                  numberOfLines={1}
                  flexShrink={1}
                >
                  {m.label}
                </Text>
                {m.kcal > 0 ? (
                  <Text
                    fontFamily="$mono"
                    fontSize={11}
                    color="$text3"
                    fontVariant={["tabular-nums"]}
                    testID={`fuel-meal-kcal-${m.key}`}
                  >
                    {intl(m.kcal)} kcal
                  </Text>
                ) : null}
              </View>
              {m.macroLine ? (
                <Text
                  fontFamily="$mono"
                  fontSize={11}
                  color="$text3"
                  fontVariant={["tabular-nums"]}
                  marginTop={2}
                  testID={`fuel-meal-macros-${m.key}`}
                >
                  {m.macroLine}
                </Text>
              ) : null}
            </View>
            <View flexDirection="row" alignItems="center" gap={8}>
              <IconBtn
                size={28}
                tone="primary"
                icon={<IconPlus size={16} strokeWidth={2.2} />}
                onPress={() => onAddToMeal(m.key)}
                testID={`fuel-meal-add-${m.key}`}
                accessibilityLabel={`Add to ${m.label}`}
              />
              {onMealOptions ? (
                <IconBtn
                  size={28}
                  tone="ghost"
                  icon={<IconMore size={16} />}
                  onPress={() => onMealOptions(m.key)}
                  testID={`fuel-meal-more-${m.key}`}
                  accessibilityLabel={`${m.label} options: copy, save as meal, clear`}
                />
              ) : null}
            </View>
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
      {onEditMeals ? (
        <Pressable
          onPress={onEditMeals}
          accessibilityRole="button"
          testID="fuel-edit-meals"
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View
            height={32}
            paddingHorizontal={12}
            borderRadius={9999}
            borderWidth={1}
            borderColor="$border"
            backgroundColor="$surface"
            flexDirection="row"
            alignItems="center"
            gap={6}
          >
            <IconPlus size={14} color="#C2C2CE" />
            <Text
              fontFamily="$body"
              fontSize={12}
              fontWeight="600"
              color="$text2"
            >
              Add or edit meals
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
