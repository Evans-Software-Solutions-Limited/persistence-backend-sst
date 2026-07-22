import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";
import { Pressable } from "react-native";

import { type HabitTone } from "@/ui/components/composite";
import { toneHex, toneTokens } from "@/ui/components/foundation/tones";
import { IconMinus, IconPlus } from "@/ui/components/icons";

/**
 * Habit-setup inline control primitives (18-habit-setup, Phase 18.7 — T-18.7.7),
 * ported 1:1 from the prototype `~/Downloads/habit_design/habit-setup.jsx`
 * (`Switch`, `Stepper`, `WeekFreq`, `Row`). Kept together — they're only used
 * by `HabitCardPresenter`. Colours resolve through the tone tokens (Tamagui
 * `$token`) for Views and `toneHex` for the SVG icon glyphs.
 */

// ── iOS-style toggle ─────────────────────────────────────────────
export function Switch({
  on,
  onChange,
  tone = "primary",
  disabled = false,
  testID,
  accessibilityLabel,
}: {
  on: boolean;
  onChange?: (next: boolean) => void;
  tone?: HabitTone;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const t = toneTokens(tone);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => onChange?.(!on)}
      hitSlop={8}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <View
        width={46}
        height={28}
        borderRadius={999}
        borderWidth={1}
        backgroundColor={on ? t.base : "$surface3"}
        borderColor={on ? t.base : "$border2"}
        position="relative"
        style={{ flexShrink: 0 }}
      >
        <View
          position="absolute"
          top={2}
          left={on ? 20 : 2}
          width={22}
          height={22}
          borderRadius={9999}
          backgroundColor={on ? "$bg" : "$text3"}
        />
      </View>
    </Pressable>
  );
}

// ── Inline stepper (− value + ) ──────────────────────────────────
export function Stepper({
  value,
  unit,
  format,
  tone,
  onDec,
  onInc,
  atMin,
  atMax,
  testID,
}: {
  value: number;
  unit: string;
  format: (v: number) => string;
  tone: HabitTone;
  onDec: () => void;
  onInc: () => void;
  atMin: boolean;
  atMax: boolean;
  testID?: string;
}) {
  const t = toneTokens(tone);
  const btn = (disabled: boolean, accent: boolean) => ({
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: disabled ? "$surface2" : accent ? t.dim : "$surface3",
    borderWidth: 1,
    borderColor: disabled ? "$border" : accent ? t.dim : "$border2",
  });
  const iconColor = (disabled: boolean, accent: boolean) =>
    disabled ? "#5A5A66" : accent ? toneHex(tone).base : "#F4F4F8";

  return (
    <View flexDirection="row" alignItems="center" gap={9} testID={testID}>
      <Pressable
        testID={testID ? `${testID}-dec` : undefined}
        accessibilityRole="button"
        accessibilityLabel="Decrease"
        accessibilityState={{ disabled: atMin }}
        disabled={atMin}
        onPress={onDec}
        hitSlop={6}
      >
        <View {...btn(atMin, false)}>
          <IconMinus
            size={14}
            strokeWidth={2.5}
            color={iconColor(atMin, false)}
          />
        </View>
      </Pressable>
      <View
        minWidth={58}
        flexDirection="row"
        alignItems="baseline"
        justifyContent="center"
        gap={3}
      >
        <Text
          fontFamily="$mono"
          fontWeight="500"
          fontSize={19}
          color={t.base}
          testID={testID ? `${testID}-value` : undefined}
        >
          {format(value)}
        </Text>
        <Text fontFamily="$mono" fontSize={11} color="$text3">
          {unit}
        </Text>
      </View>
      <Pressable
        testID={testID ? `${testID}-inc` : undefined}
        accessibilityRole="button"
        accessibilityLabel="Increase"
        accessibilityState={{ disabled: atMax }}
        disabled={atMax}
        onPress={onInc}
        hitSlop={6}
      >
        <View {...btn(atMax, true)}>
          <IconPlus
            size={14}
            strokeWidth={2.5}
            color={iconColor(atMax, true)}
          />
        </View>
      </Pressable>
    </View>
  );
}

// ── "Times a week" pips (1–7) ────────────────────────────────────
export function WeekFreq({
  value,
  tone,
  onChange,
  disabled = false,
  testID,
}: {
  value: number;
  tone: HabitTone;
  onChange: (n: number) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const t = toneTokens(tone);
  return (
    <View flexDirection="row" alignItems="center" gap={9} testID={testID}>
      <View flexDirection="row" gap={4}>
        {[1, 2, 3, 4, 5, 6, 7].map((n) => {
          const active = n <= value;
          return (
            <Pressable
              key={n}
              testID={testID ? `${testID}-pip-${n}` : undefined}
              accessibilityRole="button"
              accessibilityLabel={`${n} days`}
              disabled={disabled}
              onPress={() => onChange(n)}
              hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
            >
              <View
                width={13}
                height={24}
                borderRadius={4}
                borderWidth={1}
                backgroundColor={active ? t.base : "$surface3"}
                borderColor={active ? t.base : "$border2"}
              />
            </Pressable>
          );
        })}
      </View>
      <View
        flexDirection="row"
        alignItems="baseline"
        minWidth={26}
        justifyContent="flex-end"
      >
        <Text fontFamily="$mono" fontSize={13} color="$text2">
          {value}
        </Text>
        <Text fontFamily="$mono" fontSize={11} color="$text4">
          /7
        </Text>
      </View>
    </View>
  );
}

// ── Control row (label left · control right) ─────────────────────
export function Row({
  label,
  first = false,
  children,
}: {
  label: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      gap={12}
      paddingVertical={11}
      borderTopWidth={first ? 0 : 1}
      borderColor="$border"
    >
      <Text fontFamily="$body" fontSize={13} fontWeight="500" color="$text2">
        {label}
      </Text>
      {children}
    </View>
  );
}
