import { Text, View } from "@tamagui/core";
import { IconUsers } from "@/ui/components/icons";
import { Btn } from "@/ui/components/foundation/Btn";
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
    <View
      flexDirection="row"
      alignItems="center"
      gap={10}
      paddingVertical={8}
      paddingHorizontal={14}
      borderTopWidth={1}
      borderColor="$border"
      backgroundColor="$surface"
      testID="together-workout-row"
    >
      <View
        width={26}
        height={26}
        borderRadius={99}
        backgroundColor="$primaryDim"
        alignItems="center"
        justifyContent="center"
      >
        <IconUsers size={14} color={color.$primary} />
      </View>
      <Text
        flex={1}
        fontFamily="$display"
        fontSize={12.5}
        fontWeight="600"
        color="$text"
      >
        Train together
        <Text
          fontFamily="$body"
          fontSize={11.5}
          fontWeight="400"
          color="$text3"
        >
          {" "}
          · {detail}
        </Text>
      </Text>
      <Btn size="sm" variant="soft" onPress={onStart} testID="together-start">
        Start
      </Btn>
    </View>
  );
}
