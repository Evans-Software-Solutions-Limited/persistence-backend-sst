import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

/** Canvas `.pill`: a quiet 32pt control with a 44pt hit area; `primary` is the filled Start. */
export function TogetherPill(p: {
  children?: ReactNode;
  icon?: ReactNode;
  onPress(): void;
  tone?: "neutral" | "primary";
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const primary = p.tone === "primary";
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel}
      accessibilityState={{ disabled: !!p.disabled }}
      testID={p.testID}
      style={({ pressed }) => ({
        opacity: pressed ? 0.8 : p.disabled ? 0.5 : 1,
      })}
    >
      <View
        height={32}
        minWidth={32}
        paddingHorizontal={p.children ? 12 : 0}
        borderRadius={10}
        borderWidth={primary ? 0 : 1}
        borderColor="$border2"
        backgroundColor={primary ? "$primary" : "$surface2"}
        alignItems="center"
        justifyContent="center"
        flexDirection="row"
        gap={6}
      >
        {p.icon}
        {p.children !== undefined && (
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={12}
            color={primary ? "$primaryInk" : "$text2"}
          >
            {p.children}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
