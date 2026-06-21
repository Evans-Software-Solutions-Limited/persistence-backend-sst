import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";

import { type Tone, toneTokens } from "../foundation/tones";

/**
 * <MicroPill> — horizontal icon + (mono value over label) cell, toned
 * background. Used by TodayHero's 4-up row + active-session header chips.
 * Source: home.jsx:137 — icon on the LEFT with value/label stacked to its
 * right, NOT a vertical icon-over-value-over-label column. The prototype is
 * the source of truth (it previously rendered as a vertical stack).
 * Implements 01-design-system/design.md § Composite primitives #3.
 */

const TABULAR: ["tabular-nums"] = ["tabular-nums"];

export type MicroPillProps = {
  icon: ReactNode;
  value: string;
  label: string;
  tone: Tone;
  testID?: string;
  accessibilityLabel?: string;
};

export function MicroPill({
  icon,
  value,
  label,
  tone,
  testID,
  accessibilityLabel,
}: MicroPillProps) {
  const t = toneTokens(tone);

  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? `${label} ${value}`}
      flex={1}
      flexDirection="row"
      alignItems="center"
      gap={6}
      paddingVertical={6}
      paddingHorizontal={8}
      borderRadius={10}
      backgroundColor={t.dim}
      borderColor={t.dim}
      borderWidth={1}
    >
      <View flexDirection="row">{icon}</View>
      <View flex={1} minWidth={0}>
        <Text
          fontFamily="$mono"
          fontWeight="600"
          fontSize={12}
          color={t.base}
          fontVariant={TABULAR}
          numberOfLines={1}
        >
          {value}
        </Text>
        <Text
          fontFamily="$display"
          fontSize={8.5}
          fontWeight="600"
          letterSpacing={1}
          textTransform="uppercase"
          color="$text3"
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}
