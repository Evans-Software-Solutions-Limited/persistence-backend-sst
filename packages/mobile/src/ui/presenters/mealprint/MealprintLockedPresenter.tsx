import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation";
import { IconCheck, IconCrown } from "@/ui/components/icons";
import { BackBtn } from "@/ui/presenters/fuel/plans/PlanChrome";
import { MealprintPage, MealprintTitle } from "./MealprintChrome";

/**
 * <MealprintLockedPresenter> — canvas N26 (PER-134): the full-page locked
 * Mealprint for anyone without Premium+. No taster and no price; gold only
 * on the Premium+ pill. The canvas's old "Core" label is gone (the tiers are
 * Free, Premium and Premium+). Pure.
 */

export type MealprintLockedProps = {
  onBack: () => void;
  onUpgrade: () => void;
  testID?: string;
};

const BENEFITS: readonly [string, string][] = [
  ["One meal, right now", "Ideas that fit what you have left today"],
  ["A whole day, planned", "Your meals, filled to your target"],
  ["A shopping list", "Everything the day needs, by aisle"],
  ["Your preferences, respected", "Diet, allergens and foods you dislike"],
];

export function MealprintLockedPresenter({
  onBack,
  onUpgrade,
  testID = "mealprint-locked",
}: MealprintLockedProps) {
  return (
    <MealprintPage
      testID={testID}
      left={<BackBtn onPress={onBack} testID={`${testID}-back`} />}
      eyebrow="Mealprint"
      footer={
        <>
          <Btn
            variant="filled"
            tone="primary"
            size="lg"
            full
            onPress={onUpgrade}
            testID={`${testID}-upgrade`}
          >
            See Premium+
          </Btn>
          <Btn
            variant="ghost"
            tone="primary"
            size="lg"
            full
            onPress={onBack}
            testID={`${testID}-not-now`}
          >
            Not now
          </Btn>
        </>
      }
    >
      <View
        marginTop={60}
        alignSelf="flex-start"
        flexDirection="row"
        alignItems="center"
        gap={5}
        height={22}
        paddingHorizontal={9}
        borderRadius={9999}
        backgroundColor="rgba(245,197,24,0.12)"
        testID={`${testID}-pill`}
      >
        <IconCrown size={12} color="#F5C518" />
        <Text
          fontFamily="$body"
          fontSize={10}
          fontWeight="700"
          letterSpacing={1.4}
          textTransform="uppercase"
          color="$gold"
        >
          Premium+
        </Text>
      </View>
      <MealprintTitle size={38} marginTop={16}>
        {"Meals that fit\nwhat's left."}
      </MealprintTitle>
      <Text
        marginTop={12}
        fontFamily="$body"
        fontSize={14}
        lineHeight={20}
        color="$text2"
      >
        Unlock ideas that fit the calories and protein you have left.
      </Text>
      <View marginTop={30} borderTopWidth={1} borderColor="$border">
        {BENEFITS.map(([title, sub]) => (
          <View
            key={title}
            flexDirection="row"
            alignItems="center"
            gap={12}
            paddingVertical={16}
            borderBottomWidth={1}
            borderColor="$border"
          >
            <IconCheck size={18} color="#22D3EE" />
            <View flex={1} gap={2}>
              <Text
                fontFamily="$body"
                fontSize={15}
                fontWeight="500"
                color="$text"
              >
                {title}
              </Text>
              <Text fontFamily="$body" fontSize={12} color="$text3">
                {sub}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </MealprintPage>
  );
}
