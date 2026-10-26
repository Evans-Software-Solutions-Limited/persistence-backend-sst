import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation";
import { TogetherBtn } from "./TogetherBtn";
import { TogetherEyebrow } from "./TogetherEyebrow";

/**
 * Canvas row 3b phone 1: the host's Finish workout is two choices and
 * nothing else. Each athlete still rates and saves their own result;
 * discarding stays where solo has it, on the rating screen.
 */
export function TogetherFinishChoicePresenter({
  visible,
  onCancel,
  onFinishAll,
  onFinishOwn,
}: {
  visible: boolean;
  onCancel: () => void;
  onFinishAll: () => void;
  onFinishOwn: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      height="content"
      contentPadding={{ top: 4, bottom: 28 }}
      testID="together-finish-choice"
    >
      <View gap={14}>
        <View gap={6}>
          <TogetherEyebrow>Train together</TogetherEyebrow>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={22}
            lineHeight={28}
            letterSpacing={-0.5}
            color="$text"
            accessibilityRole="header"
          >
            Finish workout?
          </Text>
          <Text fontFamily="$body" fontSize={14} lineHeight={21} color="$text2">
            Everyone rates and saves their own result.
          </Text>
        </View>
        <View gap={10}>
          <TogetherBtn onPress={onFinishAll} testID="together-finish-all">
            Finish for all
          </TogetherBtn>
          <TogetherBtn
            variant="ghost"
            onPress={onFinishOwn}
            testID="together-finish-own"
          >
            Finish just for me
          </TogetherBtn>
        </View>
      </View>
    </BottomSheet>
  );
}
