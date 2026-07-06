import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";

import { HeaderBar, IconBtn } from "@/ui/components/foundation";
import { IconBack, IconInfo } from "@/ui/components/icons";
import {
  HABIT_ORDER,
  type HabitCategory,
  type HabitConfig,
} from "@/domain/models/habit-config";
import { HabitCardPresenter } from "./HabitCardPresenter";
import { StreakSectionPresenter } from "./StreakSectionPresenter";

/**
 * <HabitSetupPresenter> — the one-page habit setup screen (18-habit-setup,
 * Phase 18.7 — T-18.7.7). Pure port of the prototype `HabitSetupScreen`
 * (~/Downloads/habit_design/habit-setup.jsx + README § Layout): header (back +
 * "HABIT SETUP" eyebrow + "Your habits" + intro), the collection
 * `StreakSection`, five `HabitCard`s in order (water, gym, steps, sleep,
 * calories), and a footer note pointing to Home for holidays. Pure — the
 * container owns all data + callbacks.
 */

export type HabitSetupPresenterProps = {
  /** Keyed by category; the presenter renders them in HABIT_ORDER. */
  configs: Record<HabitCategory, HabitConfig>;
  streak: number;
  longest: number;
  freezeTokens: number;
  atRisk: boolean;
  skipped: boolean;
  /** Optional intro override (coach view swaps the copy). */
  intro?: string;
  /** Optional coach-attribution eyebrow shown under the title (coach view). */
  coachSubtitle?: string;
  onBack: () => void;
  onToggle: (category: HabitCategory, next: boolean) => void;
  onTargetChange: (category: HabitCategory, next: number) => void;
  onFreqChange: (category: HabitCategory, next: number) => void;
  onLeniencyChange: (category: HabitCategory, next: number) => void;
  onSpendFreeze: () => void;
  onAdjustNutrition: () => void;
  testID?: string;
};

const DEFAULT_INTRO =
  "Set each target and how often you'll hit it. Your streak counts them all.";

export function HabitSetupPresenter({
  configs,
  streak,
  longest,
  freezeTokens,
  atRisk,
  skipped,
  intro,
  coachSubtitle,
  onBack,
  onToggle,
  onTargetChange,
  onFreqChange,
  onLeniencyChange,
  onSpendFreeze,
  onAdjustNutrition,
  testID = "habit-setup",
}: HabitSetupPresenterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View flex={1} paddingTop={insets.top} testID={testID}>
      <HeaderBar
        large
        eyebrow="HABIT SETUP"
        title="Your habits"
        sub={intro ?? DEFAULT_INTRO}
        leading={
          <IconBtn
            icon={<IconBack size={18} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Back"
            testID={`${testID}-back`}
          />
        }
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 2,
          paddingBottom: insets.bottom + 40,
          gap: 14,
        }}
      >
        {coachSubtitle ? (
          <Text
            fontFamily="$body"
            fontSize={12}
            color="$accentTrainer"
            testID={`${testID}-coach-subtitle`}
          >
            {coachSubtitle}
          </Text>
        ) : null}

        <StreakSectionPresenter
          streak={streak}
          longest={longest}
          freezeTokens={freezeTokens}
          atRisk={atRisk}
          skipped={skipped}
          onSpendFreeze={onSpendFreeze}
        />

        {HABIT_ORDER.map((category) => (
          <HabitCardPresenter
            key={category}
            config={configs[category]}
            onToggle={(next) => onToggle(category, next)}
            onTargetChange={(next) => onTargetChange(category, next)}
            onFreqChange={(next) => onFreqChange(category, next)}
            onLeniencyChange={(next) => onLeniencyChange(category, next)}
            onAdjustNutrition={onAdjustNutrition}
            testID={`${testID}-card-${category}`}
          />
        ))}

        {/* Footer note — holidays live on Home (locked decision 11). */}
        <View
          flexDirection="row"
          gap={10}
          paddingVertical={13}
          paddingHorizontal={14}
          marginTop={2}
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$border"
          borderRadius={14}
          testID={`${testID}-footer`}
        >
          <View style={{ flexShrink: 0, marginTop: 1 }}>
            {/* --text-4 neutral in the prototype. */}
            <IconInfo size={15} color="#5A5A66" />
          </View>
          <Text
            fontFamily="$body"
            fontSize={11.5}
            color="$text3"
            lineHeight={17}
            flex={1}
          >
            Going away? Schedule a break from{" "}
            <Text fontFamily="$body" fontSize={11.5} color="$text2">
              Home
            </Text>{" "}
            — your streak pauses for the dates you&rsquo;re gone, pro-rated
            around the habits due that week.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
