import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";

import { type Tone, toneTokens } from "../foundation/tones";

/**
 * <SummaryChip> — big toned count + label, shares a row via flex:1.
 * Used by Trainer Clients summary + any "N waiting" / "N missed" surface.
 * Source: extra.jsx:243.
 * Implements 01-design-system/design.md § Composite primitives #6.
 */

const TABULAR: ["tabular-nums"] = ["tabular-nums"];

export type SummaryChipProps = {
  count: number;
  label: string;
  tone: Tone;
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
};

/**
 * Pressable style for SummaryChip — exported so the pressed-state branch is
 * unit-testable (RNTL flattens the rendered style function and never invokes
 * the `pressed` arm).
 */
export function summaryChipPressStyle({ pressed }: { pressed: boolean }) {
  return { flex: 1, opacity: pressed ? 0.8 : 1 };
}

export function SummaryChip({
  count,
  label,
  tone,
  onPress,
  testID,
  accessibilityLabel,
}: SummaryChipProps) {
  const t = toneTokens(tone);
  const label11y = accessibilityLabel ?? `${count} ${label}`;

  const body = (
    <View
      flex={1}
      padding={12}
      borderRadius={14}
      backgroundColor={t.dim}
      borderColor={t.dim}
      borderWidth={1}
      gap={2}
      minHeight={onPress ? 44 : undefined}
    >
      <Text
        fontFamily="$mono"
        fontWeight="600"
        fontSize={22}
        color={t.base}
        fontVariant={TABULAR}
      >
        {count}
      </Text>
      <Text fontFamily="$body" fontSize={11} color="$text2" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) {
    return (
      <View testID={testID} accessibilityLabel={label11y} flex={1}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label11y}
      style={summaryChipPressStyle}
    >
      {body}
    </Pressable>
  );
}
