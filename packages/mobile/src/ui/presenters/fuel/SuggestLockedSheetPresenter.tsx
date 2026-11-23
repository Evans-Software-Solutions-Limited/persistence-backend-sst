import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn, Pill } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconCheck } from "@/ui/components/icons";

/**
 * <SuggestLockedSheetPresenter> — the locked Mealprint page (canvas N26) that
 * Free and Premium see from Suggest (PER-132). No taster and no price, as the
 * canvas says. The canvas's old "Core" label is gone: the tiers are Free,
 * Premium and Premium+.
 */

export type SuggestLockedSheetProps = {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  testID?: string;
};

const BENEFITS: readonly [string, string][] = [
  ["One meal, right now", "Ideas that fit what you have left today"],
  ["A whole day, planned", "Your meals, filled to your target"],
  ["A shopping list", "Everything the day needs, by aisle"],
  ["Your preferences, respected", "Diet, allergens and foods you dislike"],
];

export function SuggestLockedSheetPresenter({
  visible,
  onClose,
  onUpgrade,
  testID = "suggest-locked-sheet",
}: SuggestLockedSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      eyebrow="Mealprint"
      accent="gold"
      height="content"
      testID={testID}
    >
      <View gap={16}>
        <View alignSelf="flex-start">
          <Pill tone="gold" size="xs">
            Premium+
          </Pill>
        </View>
        <Text
          fontFamily="$display"
          fontSize={28}
          lineHeight={32}
          fontWeight="800"
          color="$text"
        >
          Meals that fit what&apos;s left.
        </Text>
        <Text fontFamily="$body" fontSize={15} color="$text2">
          Unlock ideas that fit the calories and protein you have left.
        </Text>
        <View gap={12}>
          {BENEFITS.map(([title, sub]) => (
            <View key={title} flexDirection="row" gap={10}>
              <IconCheck size={18} color={toneHex("gold").base} />
              <View flex={1}>
                <Text
                  fontFamily="$body"
                  fontSize={15}
                  fontWeight="600"
                  color="$text"
                >
                  {title}
                </Text>
                <Text fontFamily="$body" fontSize={13} color="$text3">
                  {sub}
                </Text>
              </View>
            </View>
          ))}
        </View>
        <Btn
          variant="filled"
          tone="gold"
          size="lg"
          full
          onPress={onUpgrade}
          testID={`${testID}-upgrade`}
        >
          See Premium+
        </Btn>
        <Btn
          variant="ghost"
          tone="gold"
          size="md"
          full
          onPress={onClose}
          testID={`${testID}-not-now`}
        >
          Not now
        </Btn>
      </View>
    </BottomSheet>
  );
}
