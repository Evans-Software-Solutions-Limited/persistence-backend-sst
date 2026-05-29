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

import { type Tone, toneTokens } from "./tones";

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
} {
  if (tone === "neutral") {
    return { fg: "$text2", bg: "$surface2", border: "$border" };
  }
  if (tone === "ghost") {
    return { fg: "$text2", bg: "transparent", border: "transparent" };
  }
  const t = toneTokens(tone as Tone);
  return { fg: t.base, bg: t.dim, border: t.dim };
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
  const fg = active ? "$primary" : resolved.fg;
  const border = active ? "$primaryDim" : resolved.border;

  // Inject the resolved foreground onto the icon (lucide icons take `color`),
  // unless the caller already set an explicit colour. Mirrors the prototype's
  // CSS `color` inheritance.
  const tintedIcon =
    isValidElement(icon) &&
    (icon.props as { color?: unknown }).color === undefined
      ? cloneElement(icon as ReactElement<{ color?: string }>, {
          color: fg,
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

/** The resolved foreground token for a tone — primitives use this to colour the icon. */
export function iconBtnForeground(tone: IconBtnTone, active = false): string {
  if (active) return "$primary";
  return resolveTone(tone).fg;
}
