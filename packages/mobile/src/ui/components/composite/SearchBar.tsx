import { View } from "@tamagui/core";
import type { ReactNode } from "react";
import { TextInput } from "react-native";

import { IconSearch, iconDefaults } from "../icons";

/**
 * <SearchBar> — 40pt input with a leading search icon.
 * Used by the Train hub Exercises tab + Trainer Clients screen + any future
 * search. Source: prototype-hubs.jsx (Exercises) + extra.jsx (Clients).
 * Implements 01-design-system/design.md § Composite primitives #10.
 */

export type SearchBarProps = {
  placeholder: string;
  value: string;
  onChangeText: (next: string) => void;
  onSubmit?: () => void;
  /** Optional trailing node (e.g. a filter IconBtn). */
  trailing?: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
};

export function SearchBar({
  placeholder,
  value,
  onChangeText,
  onSubmit,
  trailing,
  testID,
  accessibilityLabel,
}: SearchBarProps) {
  return (
    <View
      testID={testID}
      flexDirection="row"
      alignItems="center"
      gap={8}
      height={40}
      paddingHorizontal={14}
      borderRadius={10}
      backgroundColor="$surface2"
      borderColor="$border"
      borderWidth={1}
    >
      <IconSearch {...iconDefaults({ size: 16 })} color="#8A8A98" />
      <TextInput
        testID={testID ? `${testID}-input` : undefined}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor="#8A8A98"
        returnKeyType="search"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        style={{
          flex: 1,
          fontFamily: "Geist",
          fontSize: 14,
          color: "#F4F4F8",
          padding: 0,
        }}
      />
      {trailing}
    </View>
  );
}
