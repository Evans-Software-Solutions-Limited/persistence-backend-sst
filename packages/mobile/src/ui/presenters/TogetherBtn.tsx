import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

/**
 * The canvas `.btn` family for the Together screens (PER-60): 52pt primary,
 * `soft` (primary dim), `ghost` (primary outline) and `quiet` (surface2 with a
 * hairline); `md` is the same button at 44pt (canvas `.btn` with `height:44px`:
 * code card, empty and failed states, the Wi-Fi sheet); `sm` is the 44pt row
 * action with a 10pt radius and a 13pt label.
 */
export function TogetherBtn(p: {
  children: string;
  onPress(): void;
  variant?: "primary" | "soft" | "ghost" | "quiet";
  size?: "lg" | "md" | "sm";
  icon?: ReactNode;
  disabled?: boolean;
  /** Stretch to the row (canvas `width:100%`); `sm` hugs its label unless set. */
  full?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const variant = p.variant ?? "primary";
  const sm = p.size === "sm";
  const colors = {
    primary: { bg: "$primary", text: "$primaryInk", border: "transparent" },
    soft: { bg: "$primaryDim", text: "$primary", border: "transparent" },
    ghost: { bg: "transparent", text: "$primary", border: "$primary" },
    quiet: { bg: "$surface2", text: "$text2", border: "$border2" },
  }[variant];
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel}
      accessibilityState={{ disabled: !!p.disabled }}
      testID={p.testID}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : p.disabled ? 0.45 : 1,
        alignSelf:
          p.full === false || (sm && p.full === undefined)
            ? "flex-start"
            : "stretch",
      })}
    >
      <View
        height={sm || p.size === "md" ? 44 : 52}
        paddingHorizontal={sm ? 16 : 20}
        borderRadius={sm ? 10 : 14}
        borderWidth={1}
        borderColor={colors.border}
        backgroundColor={colors.bg}
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap={8}
      >
        {p.icon}
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={sm ? 13 : 15}
          lineHeight={18}
          color={colors.text}
        >
          {p.children}
        </Text>
      </View>
    </Pressable>
  );
}
