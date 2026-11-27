import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation";
import { RefreshCw, Utensils } from "lucide-react-native";
import {
  IconChevronR,
  IconSettings,
  IconSparkles,
} from "@/ui/components/icons";
import {
  BackBtn,
  RoundIconBtn,
} from "@/ui/presenters/fuel/plans/PlanChrome";
import {
  AiCaveats,
  MACRO_COLOURS,
  MacroChips,
  MealprintPage,
  fmtKcal,
} from "./MealprintChrome";

/**
 * <MealprintIdeasPresenter> — canvas N17 "Ideas" (PER-134): a list, not
 * cards. Each idea shows its name, the AI's reason, kcal, P/C/F chips and
 * "Review and log". The label-check copy (and the halal/kosher caveat when
 * it applies) sits under the list. "Show me something else" asks again.
 * Pure.
 */

export type MealprintIdeaVM = {
  name: string;
  /** Untrusted model prose: plain text only. */
  reason: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type MealprintIdeasProps = {
  ideas: readonly MealprintIdeaVM[];
  /** What's left today, when the server sent it. */
  left: { kcal: number; proteinG: number; carbsG: number; fatG: number } | null;
  /** "kcal left today", or "kcal left that day" on another day. */
  leftLabel: string;
  dietaryPatterns: readonly string[];
  serverPartialEnforcementOnly: boolean;
  onBack: () => void;
  onPreferences: () => void;
  onSelect: (index: number) => void;
  onMore: () => void;
  moreDisabled: boolean;
  /** E.g. the search has reached its replacement limit. */
  notice: string | null;
  testID?: string;
};

export function MealprintIdeasPresenter({
  ideas,
  left,
  leftLabel,
  dietaryPatterns,
  serverPartialEnforcementOnly,
  onBack,
  onPreferences,
  onSelect,
  onMore,
  moreDisabled,
  notice,
  testID = "mealprint-ideas",
}: MealprintIdeasProps) {
  return (
    <MealprintPage
      testID={testID}
      left={<BackBtn onPress={onBack} testID={`${testID}-back`} />}
      eyebrow={`Mealprint · ${ideas.length} ${ideas.length === 1 ? "idea" : "ideas"}`}
      right={
        <RoundIconBtn
          label="Food preferences"
          onPress={onPreferences}
          testID={`${testID}-preferences`}
        >
          <IconSettings size={18} color="#F4F4F8" />
        </RoundIconBtn>
      }
      footer={
        <>
          {notice ? (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$warning"
              textAlign="center"
              testID={`${testID}-notice`}
            >
              {notice}
            </Text>
          ) : null}
          <Btn
          variant="outline"
          tone="primary"
          size="lg"
          full
          icon={<RefreshCw size={16} color="#F4F4F8" />}
          disabled={moreDisabled}
          onPress={onMore}
          testID={`${testID}-more`}
        >
          Show me something else
        </Btn>
        </>
      }
    >
      {left ? (
        <View
          flexDirection="row"
          alignItems="baseline"
          gap={8}
          testID={`${testID}-left`}
        >
          <Text
            fontFamily="$mono"
            fontSize={26}
            fontWeight="700"
            letterSpacing={-1}
            color="$text"
          >
            {fmtKcal(left.kcal)}
          </Text>
          <Text fontFamily="$body" fontSize={13} color="$text3">
            {leftLabel}
          </Text>
          <Text fontFamily="$mono" fontSize={12} marginLeft="auto">
            <Text color={MACRO_COLOURS.protein}>
              {Math.round(left.proteinG)}P
            </Text>
            <Text color="$text3"> · </Text>
            <Text color={MACRO_COLOURS.carbs}>{Math.round(left.carbsG)}C</Text>
            <Text color="$text3"> · </Text>
            <Text color={MACRO_COLOURS.fat}>{Math.round(left.fatG)}F</Text>
          </Text>
        </View>
      ) : null}
      <View marginTop={8} borderTopWidth={1} borderColor="$border2">
        {ideas.map((idea, i) => (
          <Pressable
            key={`${idea.name}-${i}`}
            onPress={() => onSelect(i)}
            accessibilityRole="button"
            accessibilityLabel={`${idea.name}, ${Math.round(idea.kcal)} kcal. Review and log`}
            testID={`${testID}-idea-${i}`}
          >
            <View
              gap={8}
              paddingVertical={14}
              borderBottomWidth={1}
              borderColor="$border2"
            >
              <View flexDirection="row" gap={14} alignItems="flex-start">
                <View
                  width={56}
                  height={56}
                  borderRadius={14}
                  backgroundColor="$surface2"
                  alignItems="center"
                  justifyContent="center"
                >
                  <Utensils size={22} color="#5C5C68" />
                </View>
                <View flex={1} gap={4}>
                  <Text
                    fontFamily="$body"
                    fontSize={16}
                    lineHeight={21}
                    fontWeight="700"
                    color="$text"
                  >
                    {idea.name}
                  </Text>
                  <View flexDirection="row" gap={6}>
                    <IconSparkles size={13} color="#8A8A98" />
                    <Text
                      flex={1}
                      fontFamily="$body"
                      fontSize={12.5}
                      lineHeight={17}
                      color="$text2"
                    >
                      {idea.reason}
                    </Text>
                  </View>
                </View>
                <View alignItems="flex-end">
                  <Text
                    fontFamily="$mono"
                    fontSize={20}
                    lineHeight={24}
                    fontWeight="700"
                    color="$text"
                  >
                    {fmtKcal(idea.kcal)}
                  </Text>
                  <Text
                    fontFamily="$body"
                    fontSize={10}
                    letterSpacing={1.2}
                    textTransform="uppercase"
                    color="$text3"
                  >
                    kcal
                  </Text>
                </View>
              </View>
              <View flexDirection="row" alignItems="center" paddingLeft={70}>
                <MacroChips
                  proteinG={idea.proteinG}
                  carbsG={idea.carbsG}
                  fatG={idea.fatG}
                />
                <View
                  marginLeft="auto"
                  flexDirection="row"
                  alignItems="center"
                  gap={2}
                >
                  <Text
                    fontFamily="$body"
                    fontSize={13}
                    fontWeight="600"
                    color="$primary"
                  >
                    Review and log
                  </Text>
                  <IconChevronR size={14} color="#22D3EE" />
                </View>
              </View>
            </View>
          </Pressable>
        ))}
      </View>
      <AiCaveats
        dietaryPatterns={dietaryPatterns}
        serverPartialEnforcementOnly={serverPartialEnforcementOnly}
        testID={`${testID}-caveat`}
      />
    </MealprintPage>
  );
}
