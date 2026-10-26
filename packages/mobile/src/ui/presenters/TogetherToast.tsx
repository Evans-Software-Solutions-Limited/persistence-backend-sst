import { Text, View } from "@tamagui/core";
import { IconCheck } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

/**
 * Canvas row 3 `.toast` (phones 3 and 5): one line over the workout after
 * leaving or ending, above the Finish footer. Read out once; never blocks
 * a tap.
 */
export function TogetherToast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View
      position="absolute"
      left={16}
      right={16}
      bottom={108}
      zIndex={200}
      flexDirection="row"
      alignItems="center"
      gap={10}
      paddingVertical={12}
      paddingHorizontal={14}
      borderRadius={14}
      borderWidth={1}
      borderColor="$border2"
      backgroundColor="$surface4"
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID="together-toast"
      style={{
        shadowColor: color.$bg,
        shadowOpacity: 0.4,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      <IconCheck size={16} color={color.$success} strokeWidth={1.75} />
      <Text
        flex={1}
        fontFamily="$body"
        fontSize={13}
        lineHeight={18}
        color="$text"
      >
        {message}
      </Text>
    </View>
  );
}
