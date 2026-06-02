import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";
import { Pressable } from "react-native";

/**
 * <FilterChip> — pill-shaped quick-filter toggle for the Train > Exercises
 * filter rail.
 * Source: ~/Downloads/handoff/design-source/prototype-hubs.jsx:110–117
 * (`TrainExercisesContent`) + screens/library.jsx:131–142.
 *
 * 32pt tall, 14pt horizontal padding. Inactive = `$surface2` fill + `$text2`
 * label + `$border`. Active = `$primary` fill + `$primaryInk` label + `$primary`
 * border.
 */

/** Pressable feedback — dim to 0.85 while pressed; never shrink in the rail.
 * Extracted so both press branches are unit-testable. */
export const chipPressStyle = ({ pressed }: { pressed: boolean }) => ({
  opacity: pressed ? 0.85 : 1,
  flexShrink: 0,
});

export type FilterChipProps = {
  active?: boolean;
  onPress: () => void;
  children: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
};

export function FilterChip({
  active = false,
  onPress,
  children,
  accessibilityLabel,
  testID,
}: FilterChipProps) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      style={chipPressStyle}
    >
      <View
        height={32}
        paddingHorizontal={14}
        borderRadius={9999}
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        backgroundColor={active ? "$primary" : "$surface2"}
        borderWidth={1}
        borderColor={active ? "$primary" : "$border"}
      >
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={12.5}
          color={active ? "$primaryInk" : "$text2"}
        >
          {children}
        </Text>
      </View>
    </Pressable>
  );
}
