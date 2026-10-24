import { Text, View } from "@tamagui/core";
import { IconUsers } from "@/ui/components/icons";
import { TogetherPill } from "./TogetherPill";
import { color } from "@/ui/theme/tokens";

/** Reviewed entry.jsx: the same slim activation strip before and during a workout. */
export function TogetherStartRow({
  detail,
  onStart,
}: {
  detail: string;
  onStart(): void;
}) {
  return (
    <View paddingHorizontal={16} testID="together-workout-row">
      <View
        flexDirection="row"
        alignItems="center"
        gap={8}
        minHeight={44}
        paddingVertical={8}
        paddingHorizontal={10}
        borderRadius={14}
        borderWidth={1}
        borderColor="$border"
        backgroundColor="$surface"
      >
        <IconUsers size={16} color={color.$text2} />
        <Text
          flex={1}
          fontFamily="$body"
          fontSize={12}
          lineHeight={16}
          color="$text3"
        >
          <Text fontFamily="$display" fontWeight="600" color="$text">
            Train together
          </Text>
          {" · "}
          {detail}
        </Text>
        <TogetherPill tone="primary" onPress={onStart} testID="together-start">
          Start
        </TogetherPill>
      </View>
    </View>
  );
}
