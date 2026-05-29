import { View } from "@tamagui/core";
import type { ReactNode } from "react";
import {
  type AccessibilityRole,
  type AccessibilityState,
  Pressable,
  type ViewStyle,
} from "react-native";

import { type Tone, toneTokens } from "./tones";

/**
 * <Card> — base elevated surface, the universal "block" wrapper.
 * Ports ~/Downloads/handoff/design-source/ui.jsx:7-25.
 * Implements 01-design-system/design.md § Foundation primitives #1 +
 * STORY-003 / STORY-005 ACs.
 */

/** Border-accent palette — full <Btn> tone set so domain-derived tones pass through. */
export type CardAccent = Tone;
/** Glow ring — narrower, reserved for the three primary brand accents. */
export type CardGlow = "primary" | "gold" | "trainer";

export type CardProps = {
  /** Base surface tier: 0=$surface, 1=$surface2 (default), 2=$surface3. */
  surface?: 0 | 1 | 2;
  /** Padding. Default 16. */
  pad?: number;
  /** Border radius. Default 14. */
  radius?: number;
  /** Adds a coloured glow ring + shadow. */
  glow?: CardGlow;
  /** Tints the border with $<accent>Dim. */
  accent?: CardAccent;
  /** When supplied the card is a Pressable; otherwise a plain View. */
  onPress?: () => void;
  children: ReactNode;
  style?: ViewStyle;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
};

const SURFACE_TOKENS = ["$surface", "$surface2", "$surface3"] as const;

export function Card({
  surface = 1,
  pad = 16,
  radius = 14,
  glow,
  accent,
  onPress,
  children,
  style,
  testID,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
}: CardProps) {
  const backgroundColor = SURFACE_TOKENS[surface] ?? SURFACE_TOKENS[1];

  // Border: accent tint > glow ring > default hairline.
  const borderColor = accent
    ? toneTokens(accent).dim
    : glow
      ? toneTokens(glow).dim
      : "$border";

  // RN can't render the handoff's layered box-shadow; approximate the glow
  // with a coloured shadow (iOS) + elevation (Android).
  const glowStyle: ViewStyle = glow
    ? {
        shadowColor: toneShadowColor(glow),
        shadowOpacity: 0.35,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
      }
    : {
        shadowColor: "rgba(0,0,0,0.4)",
        shadowOpacity: 1,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      };

  const content = (
    <View
      testID={testID}
      backgroundColor={backgroundColor}
      borderColor={borderColor}
      borderWidth={1}
      borderRadius={radius}
      padding={pad}
      position="relative"
      style={{ ...glowStyle, ...(style ?? {}) }}
      // a11y forwarded explicitly (STORY-005 AC 5.4) — only when not pressable;
      // the Pressable owns a11y in the pressable branch.
      {...(onPress
        ? {}
        : {
            accessibilityLabel,
            accessibilityRole,
            accessibilityState,
          })}
    >
      {children}
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <Pressable
      onPress={onPress}
      testID={testID ? `${testID}-pressable` : undefined}
      accessibilityRole={accessibilityRole ?? "button"}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {content}
    </Pressable>
  );
}

/** Resolve a glow tone to a concrete rgba shadow colour (RN shadowColor needs a real colour, not a token). */
function toneShadowColor(glow: CardGlow): string {
  switch (glow) {
    case "primary":
      return "rgba(34,211,238,0.35)";
    case "gold":
      return "rgba(245,197,24,0.30)";
    case "trainer":
      return "rgba(167,139,250,0.30)";
  }
}
