import { Pressable } from "react-native";
import { View } from "@tamagui/core";
import { IconBack, iconDefaults } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

/** Canvas `.ibtn`: a 44pt square, 10pt radius, surface2 with a hairline. */
export function TogetherBackButton({ onPress }: { onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        alignSelf: "flex-start",
      })}
    >
      <View
        width={44}
        height={44}
        borderRadius={10}
        backgroundColor="$surface2"
        borderWidth={1}
        borderColor="$border"
        alignItems="center"
        justifyContent="center"
      >
        <IconBack {...iconDefaults({ size: 20 })} color={color.$text2} />
      </View>
    </Pressable>
  );
}
