import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";

import { type PillTone, toneTokens } from "./tones";

/**
 * <Pill> — status / chip / badge.
 * Ports ~/Downloads/handoff/design-source/ui.jsx:85-112.
 * Implements 01-design-system/design.md § Foundation primitives #3 +
 * STORY-003 AC 3.2.
 */

export type PillSize = "xs" | "sm" | "md";

export type PillProps = {
  tone?: PillTone;
  /** xs 9.5pt / sm 10.5pt (default) / md 12pt. */
  size?: PillSize;
  /** Solid fill (tone colour bg, $bg text) instead of dim fill. */
  filled?: boolean;
  children: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
};

const SIZE_SPEC: Record<
  PillSize,
  {
    fontSize: number;
    paddingVertical: number;
    paddingHorizontal: number;
    letterSpacing: number;
  }
> = {
  xs: {
    fontSize: 9.5,
    paddingVertical: 2,
    paddingHorizontal: 6,
    letterSpacing: 0.95,
  },
  sm: {
    fontSize: 10.5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    letterSpacing: 0.63,
  },
  md: {
    fontSize: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    letterSpacing: 0,
  },
};

function neutralTokens() {
  return { fg: "$text2", bg: "$surface3", border: "$border2" };
}

export function Pill({
  tone = "neutral",
  size = "sm",
  filled = false,
  children,
  accessibilityLabel,
  testID,
}: PillProps) {
  const spec = SIZE_SPEC[size];

  let fg: string;
  let bg: string;
  let borderColor: string;

  if (tone === "neutral") {
    const n = neutralTokens();
    fg = n.fg;
    bg = n.bg;
    borderColor = n.border;
  } else {
    const t = toneTokens(tone);
    fg = t.base;
    bg = t.dim;
    borderColor = t.dim;
  }

  // `filled` flips to a solid tone fill with ink-on-tone text.
  if (filled) {
    const solid = tone === "neutral" ? "$text2" : toneTokens(tone).base;
    bg = solid;
    fg = "$bg";
    borderColor = "transparent";
  }

  return (
    <View
      testID={testID}
      // whiteSpace:nowrap + flexShrink:0 mandate — pills must never wrap or
      // compress in dense rows (design.md § Pill).
      flexShrink={0}
      alignSelf="flex-start"
      flexDirection="row"
      alignItems="center"
      gap={4}
      borderRadius={9999}
      paddingVertical={spec.paddingVertical}
      paddingHorizontal={spec.paddingHorizontal}
      backgroundColor={bg}
      borderColor={borderColor}
      borderWidth={1}
      accessibilityLabel={accessibilityLabel}
    >
      <Text
        fontFamily="$display"
        fontWeight="600"
        fontSize={spec.fontSize}
        letterSpacing={spec.letterSpacing}
        color={fg}
        numberOfLines={1}
        textTransform="uppercase"
      >
        {children}
      </Text>
    </View>
  );
}
