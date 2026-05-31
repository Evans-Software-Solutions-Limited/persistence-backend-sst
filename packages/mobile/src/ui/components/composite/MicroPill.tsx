import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";

import { type Tone, toneTokens } from "../foundation/tones";

/**
 * <MicroPill> — vertical icon + mono value + label cell, toned background.
 * Used by TodayHero's 4-up row + active-session header chips.
 * Source: home.jsx:137.
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
      alignItems="center"
      gap={4}
      padding={14}
      borderRadius={10}
      backgroundColor={t.dim}
      borderColor={t.dim}
      borderWidth={1}
    >
      <View flexDirection="row">{icon}</View>
      <Text
        fontFamily="$mono"
        fontWeight="600"
        fontSize={16}
        color={t.base}
        fontVariant={TABULAR}
      >
        {value}
      </Text>
      <Text
        fontFamily="$display"
        fontSize={9.5}
        fontWeight="600"
        letterSpacing={1}
        textTransform="uppercase"
        color="$text3"
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}
