import { Text, View } from "@tamagui/core";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  type AccessibilityState,
  Pressable,
  type ViewStyle,
} from "react-native";

import { type Tone, toneHex, toneTokens } from "./tones";

/**
 * <Btn> — primary button. 4 variants × 6 tones × 3 sizes.
 * Ports ~/Downloads/handoff/design-source/ui.jsx:117-139.
 * Implements 01-design-system/design.md § Foundation primitives #2 +
 * STORY-003 (AC 3.2, 3.3) + STORY-005 (AC 5.3, 5.4).
 */

export type BtnVariant = "filled" | "outline" | "ghost" | "soft";
export type BtnTone = Tone;
export type BtnSize = "sm" | "md" | "lg";

export type BtnProps = {
  variant?: BtnVariant;
  tone?: BtnTone;
  /** sm=36 / md=44 (default) / lg=52. sm only inside dense rows ≥44pt. */
  size?: BtnSize;
  icon?: ReactNode;
  /** Stretch to fill the parent's width. */
  full?: boolean;
  onPress: () => void;
  disabled?: boolean;
  children: ReactNode;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  testID?: string;
};

const SIZE_SPEC: Record<
  BtnSize,
  {
    height: number;
    paddingHorizontal: number;
    fontSize: number;
    gap: number;
    radius: number;
  }
> = {
  sm: { height: 36, paddingHorizontal: 12, fontSize: 13, gap: 6, radius: 10 },
  md: { height: 44, paddingHorizontal: 16, fontSize: 14, gap: 7, radius: 12 },
  lg: { height: 52, paddingHorizontal: 20, fontSize: 15, gap: 8, radius: 14 },
};

function variantStyle(
  variant: BtnVariant,
  tone: Tone,
): {
  backgroundColor: string;
  color: string;
  borderColor: string;
  borderWidth: number;
} {
  const t = toneTokens(tone);
  switch (variant) {
    case "filled":
      return {
        backgroundColor: t.base,
        color: t.ink,
        borderColor: "transparent",
        borderWidth: 1,
      };
    case "outline":
      return {
        backgroundColor: "transparent",
        color: t.base,
        borderColor: t.base,
        borderWidth: 1.5,
      };
    case "ghost":
      return {
        backgroundColor: "transparent",
        color: t.base,
        borderColor: "transparent",
        borderWidth: 1,
      };
    case "soft":
      return {
        backgroundColor: t.dim,
        color: t.base,
        borderColor: "transparent",
        borderWidth: 1,
      };
  }
}

export function Btn({
  variant = "filled",
  tone = "primary",
  size = "md",
  icon,
  full = false,
  onPress,
  disabled = false,
  children,
  accessibilityLabel,
  accessibilityState,
  testID,
}: BtnProps) {
  const spec = SIZE_SPEC[size];
  const vs = variantStyle(variant, tone);

  // Tint the icon glyph to match the button's text colour — lucide/SVG can't
  // resolve a Tamagui `$token`, so use the concrete hex. `filled` reads ink-
  // on-tone; the other variants read the tone base (same as the label). A
  // caller-set concrete colour is preserved.
  const iconHex = variant === "filled" ? toneHex(tone).ink : toneHex(tone).base;
  const existingIconColor = (icon as { props?: { color?: unknown } })?.props
    ?.color;
  const tintedIcon =
    isValidElement(icon) &&
    !(
      typeof existingIconColor === "string" &&
      existingIconColor !== "currentColor"
    )
      ? cloneElement(icon as ReactElement<{ color?: string }>, {
          color: iconHex,
        })
      : icon;

  const pressableStyle: ViewStyle = {
    minHeight: spec.height,
    width: full ? "100%" : undefined,
    alignSelf: full ? "stretch" : "flex-start",
    opacity: disabled ? 0.45 : 1,
  };

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, ...accessibilityState }}
      style={({ pressed }) => ({
        ...pressableStyle,
        opacity: pressed && !disabled ? 0.85 : pressableStyle.opacity,
      })}
    >
      <View
        height={spec.height}
        minHeight={spec.height}
        paddingHorizontal={spec.paddingHorizontal}
        borderRadius={spec.radius}
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap={spec.gap}
        backgroundColor={vs.backgroundColor}
        borderColor={vs.borderColor}
        borderWidth={vs.borderWidth}
      >
        {tintedIcon ? <View flexDirection="row">{tintedIcon}</View> : null}
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={spec.fontSize}
          color={vs.color}
        >
          {children}
        </Text>
      </View>
    </Pressable>
  );
}
