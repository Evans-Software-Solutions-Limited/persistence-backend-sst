import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";

/** Host chooses the session scope; each athlete still rates their own result. */
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
      eyebrow="TRAIN TOGETHER"
      title="Finish workout?"
      height="peek"
      testID="together-finish-choice"
      footer={
        <View gap={12}>
          <Btn full onPress={onFinishAll} testID="together-finish-all">
            Finish for all
          </Btn>
          <Btn
            full
            variant="outline"
            onPress={onFinishOwn}
            testID="together-finish-own"
          >
            Finish just for me
          </Btn>
          <Btn full variant="ghost" onPress={onCancel}>
            Keep training
          </Btn>
        </View>
      }
    >
      <Text color="$text2" fontSize={14} lineHeight={21}>
        Finish for everyone, or finish your own workout and let the others keep
        training. Each athlete rates and saves their own result.
      </Text>
    </BottomSheet>
  );
}
