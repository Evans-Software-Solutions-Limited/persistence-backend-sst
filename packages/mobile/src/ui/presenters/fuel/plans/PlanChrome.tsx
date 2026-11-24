import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { IconChevronL, IconX } from "@/ui/components/icons";

/**
 * Shared pieces of the N5 screens (PER-133): the 52pt top bar (round icon
 * button · uppercase eyebrow · right slot), the round 44pt icon button and
 * the small outlined chip. Pure.
 */

export function RoundIconBtn({
  label,
  onPress,
  children,
  testID,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <View
        width={44}
        height={44}
        borderRadius={9999}
        backgroundColor="rgba(255,255,255,0.06)"
        borderWidth={1}
        borderColor="rgba(255,255,255,0.08)"
        alignItems="center"
        justifyContent="center"
      >
        {children}
      </View>
    </Pressable>
  );
}

export function BackBtn({
  onPress,
  testID,
}: {
  onPress: () => void;
  testID?: string;
}) {
  return (
    <RoundIconBtn label="Back" onPress={onPress} testID={testID}>
      <IconChevronL size={20} color="#F4F4F8" />
    </RoundIconBtn>
  );
}

export function CloseBtn({
  onPress,
  testID,
}: {
  onPress: () => void;
  testID?: string;
}) {
  return (
    <RoundIconBtn label="Close" onPress={onPress} testID={testID}>
      <IconX size={20} color="#F4F4F8" />
    </RoundIconBtn>
  );
}

export function PlanTopBar({
  left,
  eyebrow,
  right,
}: {
  left: ReactNode;
  eyebrow: string;
  right?: ReactNode;
}) {
  return (
    <View
      height={52}
      paddingHorizontal={16}
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
    >
      {left ?? <View width={44} />}
      <Text
        fontFamily="$display"
        fontSize={11}
        fontWeight="600"
        letterSpacing={2.6}
        textTransform="uppercase"
        color="$text3"
        accessibilityRole="header"
      >
        {eyebrow}
      </Text>
      {right ?? <View width={44} />}
    </View>
  );
}

/** The cyan text button on the right of the top bar ("Save"). */
export function TopLink({
  label,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={testID}
      style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }}
    >
      <Text
        fontFamily="$body"
        fontSize={15}
        fontWeight="600"
        color={disabled ? "$text4" : "$primary"}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({
  label,
  icon,
  onPress,
  height = 32,
  selected = false,
  accessibilityLabel,
  testID,
}: {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
  height?: number;
  selected?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      testID={testID}
    >
      <View
        height={height}
        paddingHorizontal={12}
        borderRadius={9999}
        borderWidth={1}
        borderColor={selected ? "rgba(34,211,238,0.55)" : "$border2"}
        backgroundColor={selected ? "rgba(34,211,238,0.10)" : "$surface"}
        flexDirection="row"
        alignItems="center"
        gap={6}
      >
        {icon}
        <Text
          fontFamily="$body"
          fontSize={12}
          fontWeight="600"
          color={selected ? "$primary" : "$text2"}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/** The uppercase section label ("Start from", "History"). */
export function Eyebrow({
  children,
  marginTop = 0,
}: {
  children: string;
  marginTop?: number;
}) {
  return (
    <Text
      fontFamily="$display"
      fontSize={12}
      fontWeight="600"
      letterSpacing={3}
      textTransform="uppercase"
      color="$text3"
      marginTop={marginTop}
    >
      {children}
    </Text>
  );
}

/**
 * The title inside a `height="content"` sheet. `<BottomSheet>` only draws
 * its own title for scrolling sheets, so short sheets draw it here (canvas:
 * 700 22px).
 */
export function SheetTitle({
  children,
  size = 22,
}: {
  children: string;
  size?: number;
}) {
  return (
    <Text
      fontFamily="$body"
      fontSize={size}
      lineHeight={size + 6}
      fontWeight="700"
      color="$text"
      accessibilityRole="header"
    >
      {children}
    </Text>
  );
}
