import { useEffect, useState, type ReactNode } from "react";
import { Pressable, TextInput } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { IconChevronD, IconPlus } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import { MACRO_HEX, ringSegments } from "../FuelLogSummaryPresenter";
import { Chip } from "./PlanChrome";

/**
 * <PlanItemAmountSheetPresenter> — canvas N31 "Pick an amount" (PER-133),
 * the same food view as Log (N3): Serving size, Amount ("type any amount"),
 * Meal, the ½ ¾ 1 1½ chips, a ring of the item's calories and its macros.
 *
 * Adding (N30 → N31): one button, "Add to <meal> · N kcal". A food already in
 * the plan: "Save" and "Remove from plan" (Linear: tap a food in the builder
 * to change its amount or take it out). Nothing here logs food.
 *
 * Pure: the container parses the amount and works out the numbers.
 */

export type MacroShareVM = {
  label: "Protein" | "Carbs" | "Fat";
  grams: number;
  /** Share of the item's calories, 0–100. */
  pct: number;
};

export type AmountChipVM = { value: number; label: string; selected: boolean };

export type PlanItemAmountSheetProps = {
  visible: boolean;
  onClose: () => void;
  mode: "add" | "edit";
  name: string;
  sub: string;
  servingSize: string;
  amount: string;
  onAmount: (text: string) => void;
  chips: readonly AmountChipVM[];
  onChip: (value: number) => void;
  mealName: string;
  meals: readonly { id: string; name: string }[];
  onMeal: (mealId: string) => void;
  kcal: number;
  macros: readonly MacroShareVM[];
  canSave: boolean;
  onSave: () => void;
  onRemove: () => void;
  testID?: string;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
const SIZE = 96;
const R = 40;
const C = 2 * Math.PI * R;
const HEX: Record<MacroShareVM["label"], string> = {
  Protein: MACRO_HEX.protein,
  Carbs: MACRO_HEX.carbs,
  Fat: MACRO_HEX.fat,
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      paddingVertical={10}
      borderBottomWidth={1}
      borderColor="$border"
    >
      <Text fontFamily="$body" fontSize={15} fontWeight="500" color="$text">
        {label}
        {hint ? (
          <Text fontSize={11.5} fontWeight="400" color="$text3">
            {` ${hint}`}
          </Text>
        ) : null}
      </Text>
      {children}
    </View>
  );
}

function ValueBox({
  children,
  chevron = false,
}: {
  children: ReactNode;
  chevron?: boolean;
}) {
  return (
    <View
      height={40}
      minWidth={88}
      paddingHorizontal={14}
      borderRadius={12}
      backgroundColor="$surface2"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.08)"
      flexDirection="row"
      alignItems="center"
      justifyContent="flex-end"
      gap={6}
    >
      <Text fontFamily="$body" fontSize={15} fontWeight="600" color="$text">
        {children}
      </Text>
      {chevron ? <IconChevronD size={14} color="#F4F4F8" /> : null}
    </View>
  );
}

export function PlanItemAmountSheetPresenter({
  visible,
  onClose,
  mode,
  name,
  sub,
  servingSize,
  amount,
  onAmount,
  chips,
  onChip,
  mealName,
  meals,
  onMeal,
  kcal,
  macros,
  canSave,
  onSave,
  onRemove,
  testID = "plan-amount",
}: PlanItemAmountSheetProps) {
  const [pickingMeal, setPickingMeal] = useState(false);
  useEffect(() => {
    if (!visible) setPickingMeal(false);
  }, [visible]);

  const g = (l: MacroShareVM["label"]) =>
    macros.find((m) => m.label === l)?.grams ?? 0;
  const segments =
    kcal > 0 ? ringSegments(g("Carbs"), g("Fat"), g("Protein"), 1) : [];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={name}
      testID={testID}
      footer={
        <View gap={10}>
          {mode === "add" ? (
            <Btn
              variant="filled"
              tone="primary"
              size="lg"
              full
              icon={<IconPlus size={16} color="#042F39" />}
              disabled={!canSave}
              onPress={onSave}
              testID={`${testID}-save`}
            >
              {`Add to ${mealName} · ${fmt(kcal)} kcal`}
            </Btn>
          ) : (
            <>
              <Btn
                variant="filled"
                tone="primary"
                size="lg"
                full
                disabled={!canSave}
                onPress={onSave}
                testID={`${testID}-save`}
              >
                Save
              </Btn>
              <Btn
                variant="outline"
                tone="error"
                size="lg"
                full
                onPress={onRemove}
                testID={`${testID}-remove`}
              >
                Remove from plan
              </Btn>
            </>
          )}
        </View>
      }
    >
      <View gap={14}>
        <Text
          fontFamily="$body"
          fontSize={12}
          fontWeight="500"
          color="$text2"
          marginTop={-8}
          testID={`${testID}-sub`}
        >
          {sub}
        </Text>
        <View>
          <Field label="Serving size">
            <ValueBox>{servingSize}</ValueBox>
          </Field>
          <Field label="Amount" hint="type any amount">
            <TextInput
              value={amount}
              onChangeText={onAmount}
              keyboardType="decimal-pad"
              maxLength={6}
              accessibilityLabel="Amount"
              testID={`${testID}-amount`}
              style={{
                height: 40,
                minWidth: 90,
                paddingHorizontal: 14,
                borderRadius: 12,
                backgroundColor: "#1A1D29",
                borderWidth: 1,
                borderColor: "rgba(34,211,238,0.55)",
                color: "#F4F4F8",
                fontSize: 15,
                fontWeight: "600",
                textAlign: "right",
              }}
            />
          </Field>
          <Pressable
            onPress={() => setPickingMeal((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={`Meal: ${mealName}`}
            testID={`${testID}-meal`}
          >
            <Field label="Meal">
              <ValueBox chevron>{mealName}</ValueBox>
            </Field>
          </Pressable>
          {pickingMeal ? (
            <View flexDirection="row" flexWrap="wrap" gap={8} paddingTop={10}>
              {meals.map((m) => (
                <Chip
                  key={m.id}
                  label={m.name}
                  selected={m.name === mealName}
                  onPress={() => {
                    setPickingMeal(false);
                    onMeal(m.id);
                  }}
                  testID={`${testID}-meal-${m.id}`}
                />
              ))}
            </View>
          ) : null}
        </View>

        <View flexDirection="row" gap={6}>
          {chips.map((c) => (
            <Chip
              key={c.label}
              label={c.label}
              height={34}
              selected={c.selected}
              onPress={() => onChip(c.value)}
              testID={`${testID}-chip-${c.value}`}
            />
          ))}
        </View>

        <View
          flexDirection="row"
          alignItems="center"
          gap={18}
          paddingVertical={4}
        >
          <View
            width={SIZE}
            height={SIZE}
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${fmt(kcal)} kcal`}
          >
            <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
              <G rotation={-90} origin={`${SIZE / 2}, ${SIZE / 2}`}>
                <Circle
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  stroke={color.$surface3}
                  strokeWidth={9}
                  fill="none"
                />
                {segments.map((s) => (
                  <Circle
                    key={s.color}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={R}
                    stroke={s.color}
                    strokeWidth={9}
                    fill="none"
                    strokeDasharray={`${s.length.toFixed(1)} ${C.toFixed(1)}`}
                    strokeDashoffset={s.offset}
                  />
                ))}
              </G>
            </Svg>
            <View
              position="absolute"
              top={0}
              left={0}
              right={0}
              bottom={0}
              alignItems="center"
              justifyContent="center"
            >
              <Text
                fontFamily="$mono"
                fontSize={20}
                fontWeight="700"
                color="$text"
                testID={`${testID}-kcal`}
              >
                {fmt(kcal)}
              </Text>
              <Text
                fontFamily="$display"
                fontSize={9.5}
                fontWeight="600"
                letterSpacing={1.4}
                textTransform="uppercase"
                color="$text3"
              >
                kcal
              </Text>
            </View>
          </View>
          <View flex={1} flexDirection="row" gap={10}>
            {macros.map((m) => (
              <View key={m.label} flex={1} gap={3}>
                <Text
                  fontFamily="$display"
                  fontSize={10}
                  fontWeight="600"
                  letterSpacing={1.6}
                  textTransform="uppercase"
                  color={HEX[m.label]}
                >
                  {m.label}
                </Text>
                <Text fontFamily="$mono" fontSize={17} fontWeight="700">
                  <Text color="$text">{String(m.grams)}</Text>
                  <Text fontSize={11} fontWeight="500" color="$text3">
                    g
                  </Text>
                </Text>
                <Text fontFamily="$body" fontSize={10} color="$text3">
                  {`${m.pct}%`}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}
