import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

/** Reviewed Together initials: the selection border is inside the diameter. */
export function TogetherAthleteAvatar(p: {
  name: string;
  size?: number;
  selected?: boolean;
  onPress?(): void;
}) {
  const size = p.size ?? 26;
  const face = (
    <View
      width={size}
      height={size}
      borderRadius={999}
      flexShrink={0}
      borderWidth={1}
      borderColor={p.selected ? "$primary" : "$border2"}
      backgroundColor="$primaryDim"
      alignItems="center"
      justifyContent="center"
      testID="together-athlete-avatar"
    >
      <Text
        fontFamily="$display"
        fontWeight="700"
        fontSize={size * 0.4}
        color="$primary"
      >
        {p.name
          .trim()
          .split(/\s+/)
          .map((part) => part[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()}
      </Text>
    </View>
  );
  return p.onPress ? (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={`View ${p.name}’s workout`}
      accessibilityState={{ selected: !!p.selected }}
      hitSlop={Math.max(0, (44 - size) / 2)}
    >
      {face}
    </Pressable>
  ) : (
    face
  );
}
