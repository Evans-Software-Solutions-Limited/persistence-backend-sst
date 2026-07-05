import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { Btn, Card, Pill } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconCheck, IconSparkles } from "@/ui/components/icons";
import type { AiFoodItem, MealSlot } from "@/domain/models/nutrition";
import { MealPickerPresenter } from "./MealPickerPresenter";

/**
 * <AiDraftConfirmPresenter> — the shared "AI summary card + toggleable item
 * rows + meal picker + Add" confirm UI used by BOTH the Snap (photo) sheet
 * and the Quick-add "Or describe it…" (free-text) flow. Extracted so the two
 * M9.5 Tier B entry points (STORY-011 photo, STORY-012 free-text) share one
 * implementation of the draft-card review step instead of duplicating it —
 * per fuel-sheets.jsx SnapSheet's confirm stage.
 *
 * Pure: all state/handlers are props. The AI-call trigger and per-item log
 * commands live in each entry point's own container.
 *
 * Implements: specs/13-nutrition-tracking/design.md § Revised 2026-07-03
 *             › Mobile flow (SnapAISheet)
 *             specs/13-nutrition-tracking/tasks.md T-13.11.1, T-13.11.2
 */

/** A draft item in the confirm stage — the AI item + its keep/edit UI state. */
export type AiDraftItem = AiFoodItem & { on: boolean };

export type AiDraftConfirmProps = {
  items: readonly AiDraftItem[];
  onToggleItem: (index: number) => void;
  onEditGrams: (index: number, grams: number) => void;
  /** Sum of kept (on: true) items' kcal — container-computed. */
  totalKcal: number;
  slot: MealSlot;
  onSlotChange: (slot: MealSlot) => void;
  onConfirm: () => void;
  /** Renders "Added ✓" and disables the button when true. */
  added?: boolean;
  /** True while the confirm is in flight — disables the button so a
   * double-tap can't log the draft twice. */
  confirming?: boolean;
  testID?: string;
};

const intl = (n: number) => Math.round(n).toLocaleString("en-US");

function GramsInput({
  value,
  onChange,
  testID,
}: {
  value: number;
  onChange: (grams: number) => void;
  testID: string;
}) {
  return (
    <TextInput
      value={String(Math.round(value))}
      onChangeText={(text) => {
        const parsed = Number(text.replace(/[^0-9.]/g, ""));
        onChange(Number.isFinite(parsed) ? parsed : 0);
      }}
      keyboardType="numeric"
      testID={testID}
      accessibilityLabel="Serving grams"
      style={{
        width: 56,
        height: 32,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#232735",
        backgroundColor: "#181B26",
        paddingHorizontal: 8,
        color: "#F4F4F8",
        fontFamily: "Geist",
        fontSize: 13,
        textAlign: "center",
      }}
    />
  );
}

export function AiDraftConfirmPresenter({
  items,
  onToggleItem,
  onEditGrams,
  totalKcal,
  slot,
  onSlotChange,
  onConfirm,
  added = false,
  confirming = false,
  testID = "ai-draft-confirm",
}: AiDraftConfirmProps) {
  const keptCount = items.filter((i) => i.on).length;
  const gold = toneHex("gold").base;

  return (
    <View gap={14} testID={testID}>
      <Card
        pad={14}
        radius={12}
        accent="gold"
        testID={`${testID}-summary-card`}
      >
        <View flexDirection="row" alignItems="center" gap={10}>
          <IconSparkles size={16} color={gold} />
          <View flex={1}>
            <Text
              fontFamily="$body"
              fontSize={11.5}
              color="$text3"
              testID={`${testID}-summary-count`}
            >
              {keptCount} of {items.length} items · review below
            </Text>
          </View>
          <Text
            fontFamily="$mono"
            fontWeight="700"
            fontSize={22}
            color="$gold"
            testID={`${testID}-summary-kcal`}
          >
            {intl(totalKcal)}
          </Text>
        </View>
      </Card>

      <View gap={6}>
        {items.map((item, i) => (
          <View
            key={`${item.name}-${i}`}
            flexDirection="row"
            alignItems="center"
            gap={10}
            paddingVertical={10}
            paddingHorizontal={12}
            borderRadius={12}
            borderWidth={1}
            borderColor={item.on ? "$border" : "$border2"}
            backgroundColor={item.on ? "$surface2" : "transparent"}
            opacity={item.on ? 1 : 0.5}
            testID={`${testID}-item-${i}`}
          >
            <Pressable
              onPress={() => onToggleItem(i)}
              testID={`${testID}-item-${i}-toggle`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.on }}
              accessibilityLabel={`${item.on ? "Remove" : "Include"} ${item.name}`}
            >
              <View
                width={22}
                height={22}
                borderRadius={6}
                alignItems="center"
                justifyContent="center"
                backgroundColor={item.on ? "$gold" : "transparent"}
                borderWidth={1.5}
                borderColor={item.on ? "$gold" : "$border3"}
              >
                {item.on ? (
                  <IconCheck
                    size={12}
                    strokeWidth={3}
                    color={toneHex("gold").ink}
                  />
                ) : null}
              </View>
            </Pressable>
            <View flex={1}>
              <Text
                fontFamily="$body"
                fontSize={13}
                fontWeight="500"
                color="$text"
                numberOfLines={1}
              >
                {item.name}
              </Text>
              <View
                flexDirection="row"
                alignItems="center"
                gap={6}
                marginTop={2}
              >
                <GramsInput
                  value={item.estimatedGrams}
                  onChange={(g) => onEditGrams(i, g)}
                  testID={`${testID}-item-${i}-grams`}
                />
                <Text fontFamily="$body" fontSize={11} color="$text3">
                  g ·{" "}
                </Text>
                <Pill
                  tone={item.confidence < 0.7 ? "gold" : "neutral"}
                  size="xs"
                  testID={`${testID}-item-${i}-confidence`}
                >
                  {Math.round(item.confidence * 100)}% sure
                </Pill>
              </View>
            </View>
            <Text
              fontFamily="$mono"
              fontSize={12}
              color="$text2"
              testID={`${testID}-item-${i}-kcal`}
            >
              {intl(item.kcal)} kcal
            </Text>
          </View>
        ))}
      </View>

      <MealPickerPresenter
        value={slot}
        onChange={onSlotChange}
        testID={`${testID}-meal-picker`}
      />

      <Btn
        variant="filled"
        tone="gold"
        size="lg"
        full
        icon={<IconCheck size={16} strokeWidth={2.5} />}
        onPress={onConfirm}
        disabled={keptCount === 0 || added || confirming}
        testID={`${testID}-add`}
      >
        {added ? "Added ✓" : confirming ? "Adding…" : "Add to meal"}
      </Btn>
    </View>
  );
}
