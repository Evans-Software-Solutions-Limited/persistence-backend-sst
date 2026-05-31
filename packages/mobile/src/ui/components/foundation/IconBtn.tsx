import { View } from "@tamagui/core";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  type AccessibilityState,
  type GestureResponderEvent,
  Pressable,
} from "react-native";

import { type Tone, NEUTRAL_HEX, toneHex, toneTokens } from "./tones";

/**
 * <IconBtn> — circular icon button for header / floating / row actions.
 * Ports ~/Downloads/handoff/design-source/ui.jsx:255-275.
 * Implements 01-design-system/design.md § Foundation primitives #4 +
 * STORY-003 (AC 3.4) + STORY-005 (AC 5.4).
 *
 * No `onPress` → renders as a <View> so it's safe to nest inside a row-level
 * Pressable without triggering nested-button warnings. With `onPress`,
 * `event.stopPropagation()` is baked in so taps don't bubble to a parent row.
 */

export type IconBtnTone = Tone | "neutral" | "ghost";

export type IconBtnProps = {
  icon: ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  /** Default 'neutral'. Full <Btn> palette + ghost so domain tones pass through. */
  tone?: IconBtnTone;
  /** Diameter. Default 36. */
  size?: number;
  /** Active state — primary-dim fill + primary fg regardless of tone. */
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  testID?: string;
};

function resolveTone(tone: IconBtnTone): {
  fg: string;
  bg: string;
  border: string;
  fgHex: string;
} {
  if (tone === "neutral") {
    return {
      fg: "$text2",
      bg: "$surface2",
      border: "$border",
      fgHex: NEUTRAL_HEX.text2,
    };
  }
  if (tone === "ghost") {
    return {
      fg: "$text2",
      bg: "transparent",
      border: "transparent",
      fgHex: NEUTRAL_HEX.text2,
    };
  }
  const t = toneTokens(tone as Tone);
  return {
    fg: t.base,
    bg: t.dim,
    border: t.dim,
    fgHex: toneHex(tone as Tone).base,
  };
}

export function IconBtn({
  icon,
  onPress,
  tone = "neutral",
  size = 36,
  active = false,
  disabled = false,
  accessibilityLabel,
  accessibilityState,
  testID,
}: IconBtnProps) {
  const resolved = resolveTone(tone);
  const bg = active ? "$primaryDim" : resolved.bg;
  const border = active ? "$primaryDim" : resolved.border;
  // Concrete hex for the icon glyph — lucide/react-native-svg can't resolve a
  // Tamagui `$token` string, so the tint must be a real colour value.
  const fgHex = active ? NEUTRAL_HEX.primary : resolved.fgHex;

  // Inject the resolved foreground onto the icon. `iconDefaults()` sets
  // `color: "currentColor"` (a placeholder SVG can't inherit from at the Svg
  // root), so we override that; an explicit concrete colour from the caller is
  // preserved.
  const iconColor = (icon as { props?: { color?: unknown } })?.props?.color;
  const callerSetConcreteColor =
    typeof iconColor === "string" && iconColor !== "currentColor";
  const tintedIcon =
    isValidElement(icon) && !callerSetConcreteColor
      ? cloneElement(icon as ReactElement<{ color?: string }>, {
          color: fgHex,
        })
      : icon;

  const circle = (
    <View
      width={size}
      height={size}
      minWidth={size}
      minHeight={size}
      borderRadius={9999}
      flexDirection="row"
      alignItems="center"
      justifyContent="center"
      backgroundColor={bg}
      borderColor={border}
      borderWidth={1}
      style={{ flexShrink: 0 }}
    >
      {tintedIcon}
    </View>
  );

  if (!onPress) {
    // Non-pressable: a plain View, nest-safe inside a row Pressable.
    return (
      <View
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        style={{ flexShrink: 0 }}
      >
        {circle}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected: active, ...accessibilityState }}
      // Expand the effective touch target to the 44pt floor (Apple HIG) when
      // the visual diameter is smaller — keeps the 36pt look, 44pt tap area.
      hitSlop={Math.max(0, Math.ceil((44 - size) / 2))}
      onPress={(event) => {
        // Don't let the tap bubble to a parent row Pressable.
        event?.stopPropagation?.();
        onPress(event);
      }}
      style={({ pressed }) => ({
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        flexShrink: 0,
      })}
    >
      {circle}
    </Pressable>
  );
}

/** The resolved foreground colour (concrete hex) for a tone — primitives use
 * this to colour an icon glyph passed to a non-Tamagui (SVG) consumer. */
export function iconBtnForeground(tone: IconBtnTone, active = false): string {
  if (active) return NEUTRAL_HEX.primary;
  return resolveTone(tone).fgHex;
}
