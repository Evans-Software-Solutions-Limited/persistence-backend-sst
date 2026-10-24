import { Pressable } from "react-native";
import { View } from "@tamagui/core";

/**
 * The canvas `.sw` switch (row 4): a 51 × 31 track, 27pt thumb, primary when
 * on, surface3 when off. Drawn here so it reads the same on every platform
 * and in the screenshot harness, instead of the platform control.
 */
export function TogetherSwitch(p: {
  value: boolean;
  onValueChange(value: boolean): void;
  accessibilityLabel: string;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={p.accessibilityLabel}
      accessibilityState={{ checked: p.value, disabled: !!p.disabled }}
      disabled={p.disabled}
      hitSlop={8}
      onPress={() => p.onValueChange(!p.value)}
      testID={p.testID}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : p.disabled ? 0.5 : 1,
      })}
    >
      <View
        width={51}
        height={31}
        borderRadius={999}
        padding={2}
        backgroundColor={p.value ? "$primary" : "$surface3"}
        alignItems={p.value ? "flex-end" : "flex-start"}
        justifyContent="center"
      >
        <View
          width={27}
          height={27}
          borderRadius={999}
          backgroundColor="$text"
          shadowColor="rgba(0,0,0,0.4)"
          shadowOpacity={1}
          shadowRadius={3}
          shadowOffset={{ width: 0, height: 1 }}
        />
      </View>
    </Pressable>
  );
}
